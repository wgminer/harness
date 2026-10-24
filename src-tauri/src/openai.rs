use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
const OPENAI_IMAGES_GENERATIONS_URL: &str = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGES_EDITS_URL: &str = "https://api.openai.com/v1/images/edits";

/// Max assistant↔tool round-trips per user turn. Keep in sync with iOS `OpenAIClient.maxToolCallIterations`.
pub const MAX_TOOL_CALL_ITERATIONS: usize = 10;

/// Reasoning effort for chat-model requests. The chat model has no "none" level;
/// "low" keeps replies close to the latency of the non-reasoning default it replaced.
pub const CHAT_REASONING_EFFORT: &str = "low";

/// Cleared for the rest of the session if the API rejects reasoning summaries
/// (they can require organization verification); chat then runs without them.
static REASONING_SUMMARY_ENABLED: AtomicBool = AtomicBool::new(true);

/// Reasoning effort for the small title/cleanup model, which reasons unless told not to.
pub const SMALL_MODEL_REASONING_EFFORT: &str = "none";

pub fn tool_error_result(message: impl Into<String>) -> String {
    json!({ "error": message.into() }).to_string()
}

pub fn openai_chat_model() -> String {
    std::env::var("OPENAI_CHAT_MODEL").unwrap_or_else(|_| "gpt-6.1-sol".into())
}

pub fn openai_image_model() -> String {
    std::env::var("OPENAI_IMAGE_MODEL").unwrap_or_else(|_| "gpt-image-2.5-flare".into())
}

pub fn openai_title_model() -> String {
    std::env::var("OPENAI_TITLE_MODEL").unwrap_or_else(|_| "gpt-6-luna".into())
}

pub fn openai_transcript_cleanup_model() -> String {
    std::env::var("OPENAI_TRANSCRIPT_CLEANUP_MODEL").unwrap_or_else(|_| "gpt-6-luna".into())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessageParam {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallParam>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// Raw Responses API output items for an assistant tool round (reasoning,
    /// text, function calls), replayed verbatim so the model keeps its reasoning.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_items: Option<Vec<Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCallParam {
    pub id: String,
    #[serde(rename = "type")]
    pub call_type: String,
    pub function: ToolFunctionParam,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolFunctionParam {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug)]
pub enum OpenAIError {
    Http(reqwest::Error),
    Api(String),
    Cancelled,
    Json(serde_json::Error),
}

impl std::fmt::Display for OpenAIError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Http(e) => write!(f, "{e}"),
            Self::Api(msg) => write!(f, "{msg}"),
            Self::Cancelled => write!(f, "Request cancelled"),
            Self::Json(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for OpenAIError {}

impl From<reqwest::Error> for OpenAIError {
    fn from(value: reqwest::Error) -> Self {
        Self::Http(value)
    }
}

impl From<serde_json::Error> for OpenAIError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

/// Single source of truth for the desktop tool-calling schema, shared with iOS via
/// `resources/contracts/tools.json` (iOS loads the same file as a bundled resource and
/// filters it down to its supported subset — see `SharedToolDefinitions.swift`).
const TOOL_DEFINITIONS_JSON: &str = include_str!("../../resources/contracts/tools.json");

pub fn tool_definitions() -> Value {
    serde_json::from_str(TOOL_DEFINITIONS_JSON)
        .expect("resources/contracts/tools.json must be a valid tool-definitions array")
}

pub fn tools_for_request(include_coding: bool) -> Value {
    let mut tools = tool_definitions();
    if include_coding {
        tools = crate::coding::merge_tool_definitions(tools, crate::coding::coding_tool_definitions());
    }
    if crate::gmail::auth::is_connected() {
        tools = crate::coding::merge_tool_definitions(tools, crate::gmail::tool_definitions());
    }
    tools
}

pub async fn generate_thread_title_with_openai(
    api_key: &str,
    previous_title: Option<&str>,
    context: &str,
) -> Result<Option<String>, OpenAIError> {
    let client = Client::builder().timeout(Duration::from_secs(10)).build()?;
    let system = "You name chat threads for a sidebar. Reply with a short, descriptive title (a few words). \
No quotes or extra punctuation. \
If the previous title still fits the recent conversation, reply with exactly: UNCHANGED";

    let user_block = format!(
        "{}\n\nRecent conversation:\n{}",
        if let Some(title) = previous_title {
            format!("Previous title: {title}")
        } else {
            "Previous title: (none)".into()
        },
        context
    );

    let body = json!({
        "model": openai_title_model(),
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user_block }
        ],
        "max_completion_tokens": 512,
        "reasoning_effort": "low"
    });

    let response = client
        .post(OPENAI_CHAT_COMPLETIONS_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(OpenAIError::Api(detail));
    }

    let parsed: Value = response.json().await?;
    let raw = parsed
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if raw.is_empty() {
        return Ok(None);
    }
    if raw.eq_ignore_ascii_case("UNCHANGED") {
        return Ok(None);
    }
    Ok(Some(raw))
}

pub async fn chat_completion_json(
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    max_completion_tokens: u32,
    reasoning_effort: &str,
    timeout_secs: u64,
) -> Result<String, OpenAIError> {
    let client = Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()?;
    let body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ],
        "response_format": { "type": "json_object" },
        "max_completion_tokens": max_completion_tokens,
        "reasoning_effort": reasoning_effort
    });

    let response = client
        .post(OPENAI_CHAT_COMPLETIONS_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(OpenAIError::Api(detail));
    }

    let parsed: Value = response.json().await?;
    Ok(parsed
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string())
}

pub struct ImageGenerateOptions {
    pub size: String,
    pub quality: String,
    pub background: String,
    pub output_format: String,
}

fn build_image_request_body(model: &str, prompt: &str, options: &ImageGenerateOptions) -> Value {
    json!({
        "model": model,
        "prompt": prompt,
        "size": options.size,
        "quality": options.quality,
        "background": options.background,
        "output_format": options.output_format,
        "n": 1
    })
}

fn decode_image_b64_response(parsed: &Value) -> Result<Vec<u8>, OpenAIError> {
    let b64 = parsed
        .pointer("/data/0/b64_json")
        .and_then(|v| v.as_str())
        .ok_or_else(|| OpenAIError::Api("Missing image data in OpenAI response.".into()))?;

    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| OpenAIError::Api(format!("Failed to decode image data: {e}")))
}

async fn send_cancellable(
    cancel: Option<&CancellationToken>,
    future: impl std::future::Future<Output = Result<reqwest::Response, reqwest::Error>>,
) -> Result<reqwest::Response, OpenAIError> {
    match cancel {
        Some(token) => {
            tokio::select! {
                res = future => res.map_err(OpenAIError::from),
                _ = token.cancelled() => Err(OpenAIError::Cancelled),
            }
        }
        None => future.await.map_err(OpenAIError::from),
    }
}

pub async fn generate_image(
    api_key: &str,
    prompt: &str,
    options: &ImageGenerateOptions,
    cancel: Option<&CancellationToken>,
) -> Result<Vec<u8>, OpenAIError> {
    let client = Client::builder().timeout(Duration::from_secs(120)).build()?;
    let body = build_image_request_body(&openai_image_model(), prompt, options);

    let response = send_cancellable(
        cancel,
        client
            .post(OPENAI_IMAGES_GENERATIONS_URL)
            .bearer_auth(api_key)
            .json(&body)
            .send(),
    )
    .await?;

    if !response.status().is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(OpenAIError::Api(detail));
    }

    let parsed: Value = response.json().await?;
    decode_image_b64_response(&parsed)
}

/// One image part for `/v1/images/edits` (multipart `image` field).
pub struct ImageEditPart {
    pub bytes: Vec<u8>,
    pub file_name: String,
    pub mime_type: String,
}

/// Edit via `/v1/images/edits` with one or more `image` multipart parts.
pub async fn edit_image(
    api_key: &str,
    prompt: &str,
    images: &[ImageEditPart],
    options: &ImageGenerateOptions,
    cancel: Option<&CancellationToken>,
) -> Result<Vec<u8>, OpenAIError> {
    if images.is_empty() {
        return Err(OpenAIError::Api(
            "At least one image is required for edit.".into(),
        ));
    }
    let client = Client::builder().timeout(Duration::from_secs(120)).build()?;
    let mut form = reqwest::multipart::Form::new()
        .text("model", openai_image_model())
        .text("prompt", prompt.to_string())
        .text("size", options.size.clone())
        .text("quality", options.quality.clone())
        .text("background", options.background.clone())
        .text("output_format", options.output_format.clone())
        .text("n", "1");
    // Multiple images must use `image[]` (OpenAI rejects duplicate `image` parts).
    let field_name = if images.len() > 1 { "image[]" } else { "image" };
    for image in images {
        let part = reqwest::multipart::Part::bytes(image.bytes.clone())
            .file_name(image.file_name.clone())
            .mime_str(&image.mime_type)
            .map_err(|e| OpenAIError::Api(format!("Invalid image mime type: {e}")))?;
        form = form.part(field_name, part);
    }

    let response = send_cancellable(
        cancel,
        client
            .post(OPENAI_IMAGES_EDITS_URL)
            .bearer_auth(api_key)
            .multipart(form)
            .send(),
    )
    .await?;

    if !response.status().is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(OpenAIError::Api(detail));
    }

    let parsed: Value = response.json().await?;
    decode_image_b64_response(&parsed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_error_result_serializes_error_key() {
        let raw = tool_error_result("tool failed");
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(parsed["error"], "tool failed");
    }

    #[test]
    fn max_tool_call_iterations_matches_ios_cap() {
        assert_eq!(MAX_TOOL_CALL_ITERATIONS, 10);
    }

    /// Drift guard for the shared `resources/contracts/tools.json`: parses on the Rust
    /// side and contains every tool name iOS also needs to load from the same file
    /// (see `SharedToolDefinitionsTests.swift` for the iOS-side counterpart).
    #[test]
    fn tool_definitions_parses_and_contains_expected_names() {
        let defs = tool_definitions();
        let names: Vec<&str> = defs
            .as_array()
            .expect("tool_definitions() must be a JSON array")
            .iter()
            .filter_map(|t| t.pointer("/function/name")?.as_str())
            .collect();

        for expected in [
            "set_layout",
            "set_chat_mode",
            "note_list",
            "note_create",
            "note_read",
            "note_save",
            "note_delete",
        ] {
            assert!(names.contains(&expected), "missing desktop-only tool: {expected}");
        }

        for expected in [
            "task_list",
            "task_create",
            "task_update",
            "task_delete",
            "task_clear_completed",
            "memory_set",
            "memory_search_conversations",
            "web_search",
            "get_datetime",
        ] {
            assert!(names.contains(&expected), "missing shared (also-iOS) tool: {expected}");
        }

        assert_eq!(names.len(), 16, "unexpected tool count — update this test if tools.json changed intentionally");
    }
}

#[cfg(test)]
mod responses_api_tests {
    use super::*;

    fn apply_all(events: &[Value]) -> (ResponseStreamState, String) {
        let mut state = ResponseStreamState::default();
        let mut emitted = String::new();
        for event in events {
            if let Some(StreamDelta::Text(delta)) = state.apply(event) {
                emitted.push_str(&delta);
            }
        }
        (state, emitted)
    }

    fn message(role: &str, content: Option<&str>) -> ChatMessageParam {
        ChatMessageParam {
            role: role.into(),
            content: content.map(Into::into),
            tool_calls: None,
            tool_call_id: None,
            response_items: None,
        }
    }

    #[test]
    fn accumulates_text_deltas() {
        let (state, emitted) = apply_all(&[
            json!({ "type": "response.created" }),
            json!({ "type": "response.output_text.delta", "delta": "Hello" }),
            json!({ "type": "response.output_text.delta", "delta": " world" }),
        ]);
        assert_eq!(emitted, "Hello world");
        assert_eq!(state.text, "Hello world");
        assert!(state.tool_calls().is_empty());
    }

    #[test]
    fn streams_reasoning_summary_with_part_breaks() {
        let (state, emitted) = apply_all(&[
            json!({ "type": "response.reasoning_summary_part.added" }),
            json!({ "type": "response.reasoning_summary_text.delta", "delta": "First" }),
            json!({ "type": "response.reasoning_summary_part.added" }),
            json!({ "type": "response.reasoning_summary_text.delta", "delta": "Second" }),
            json!({ "type": "response.output_item.done", "item": { "type": "reasoning", "id": "rs_1", "summary": [
                { "type": "summary_text", "text": "First" },
                { "type": "summary_text", "text": "Second" }
            ] } }),
            json!({ "type": "response.output_text.delta", "delta": "Answer" }),
        ]);
        assert_eq!(state.reasoning, "First\n\nSecond");
        assert_eq!(emitted, "Answer");
    }

    #[test]
    fn falls_back_to_finished_reasoning_item_without_deltas() {
        let mut state = ResponseStreamState::default();
        let delta = state.apply(&json!({ "type": "response.output_item.done", "item": {
            "type": "reasoning", "id": "rs_1", "summary": [
                { "type": "summary_text", "text": "One" },
                { "type": "summary_text", "text": "Two" }
            ]
        } }));
        assert_eq!(delta, Some(StreamDelta::Reasoning("One\n\nTwo".into())));
        assert_eq!(state.reasoning, "One\n\nTwo");

        let empty = state.apply(&json!({ "type": "response.output_item.done", "item": {
            "type": "reasoning", "id": "rs_2", "summary": []
        } }));
        assert_eq!(empty, None);
    }

    #[test]
    fn collects_function_calls_in_output_order() {
        let (state, _) = apply_all(&[
            json!({ "type": "response.output_item.done", "item": { "type": "reasoning", "id": "rs_1", "encrypted_content": "abc" } }),
            json!({ "type": "response.output_item.done", "item": { "type": "function_call", "id": "fc_1", "call_id": "call_a", "name": "note_create", "arguments": "{\"title\":\"A\"}" } }),
            json!({ "type": "response.output_item.done", "item": { "type": "function_call", "id": "fc_2", "call_id": "call_b", "name": "get_datetime", "arguments": "" } }),
        ]);
        let calls = state.tool_calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].id, "call_a");
        assert_eq!(calls[0].function.name, "note_create");
        assert_eq!(calls[0].function.arguments, "{\"title\":\"A\"}");
        assert_eq!(calls[1].id, "call_b");
        assert_eq!(calls[1].function.arguments, "{}");
        assert_eq!(state.items.len(), 3);
    }

    #[test]
    fn completed_output_replaces_collected_items() {
        let (state, _) = apply_all(&[
            json!({ "type": "response.output_item.done", "item": { "type": "function_call", "call_id": "call_a", "name": "x", "arguments": "{}" } }),
            json!({ "type": "response.completed", "response": { "output": [
                { "type": "reasoning", "id": "rs_1" },
                { "type": "function_call", "call_id": "call_a", "name": "x", "arguments": "{}" }
            ] } }),
        ]);
        assert_eq!(state.items.len(), 2);
        assert_eq!(state.tool_calls().len(), 1);
    }

    #[test]
    fn skips_function_calls_missing_call_id() {
        let (state, _) = apply_all(&[json!({
            "type": "response.output_item.done",
            "item": { "type": "function_call", "name": "x", "arguments": "{}" }
        })]);
        assert!(state.tool_calls().is_empty());
    }

    #[test]
    fn records_failed_and_error_events() {
        let (failed, _) = apply_all(&[json!({
            "type": "response.failed",
            "response": { "error": { "message": "boom" } }
        })]);
        assert_eq!(failed.error.as_deref(), Some("boom"));

        let (errored, _) = apply_all(&[json!({ "type": "error", "message": "bad" })]);
        assert_eq!(errored.error.as_deref(), Some("bad"));
    }

    #[test]
    fn flattens_tool_definitions() {
        let tools = responses_tools(&tool_definitions());
        assert_eq!(tools.len(), tool_definitions().as_array().unwrap().len());
        for tool in &tools {
            assert_eq!(tool["type"], "function");
            assert!(tool["name"].is_string());
            assert!(tool["parameters"].is_object());
            assert_eq!(tool["strict"], false);
            assert!(tool.get("function").is_none());
        }
    }

    #[test]
    fn converts_plain_messages_to_input() {
        let input = responses_input(&[
            message("system", Some("sys")),
            message("user", Some("hi")),
            message("assistant", Some("")),
            message("assistant", Some("hello")),
        ]);
        assert_eq!(
            input,
            vec![
                json!({ "role": "system", "content": "sys" }),
                json!({ "role": "user", "content": "hi" }),
                json!({ "role": "assistant", "content": "hello" }),
            ]
        );
    }

    #[test]
    fn replays_response_items_verbatim_then_tool_output() {
        let items = vec![
            json!({ "type": "reasoning", "id": "rs_1", "encrypted_content": "abc" }),
            json!({ "type": "function_call", "id": "fc_1", "call_id": "call_a", "name": "x", "arguments": "{}" }),
        ];
        let mut assistant = message("assistant", None);
        assistant.response_items = Some(items.clone());
        let mut tool = message("tool", Some("{\"ok\":true}"));
        tool.tool_call_id = Some("call_a".into());

        let input = responses_input(&[assistant, tool]);
        assert_eq!(input[..2], items[..]);
        assert_eq!(
            input[2],
            json!({ "type": "function_call_output", "call_id": "call_a", "output": "{\"ok\":true}" })
        );
    }

    /// Gated-tool checkpoints written before the Responses migration have no
    /// `response_items`; they must still load and convert.
    #[test]
    fn converts_legacy_checkpoint_tool_round() {
        let legacy: Vec<ChatMessageParam> = serde_json::from_value(json!([
            { "role": "assistant", "content": "On it.", "tool_calls": [
                { "id": "call_a", "type": "function", "function": { "name": "x", "arguments": "{}" } }
            ] },
            { "role": "tool", "content": "done", "tool_call_id": "call_a" }
        ]))
        .unwrap();
        assert_eq!(
            responses_input(&legacy),
            vec![
                json!({ "role": "assistant", "content": "On it." }),
                json!({ "type": "function_call", "call_id": "call_a", "name": "x", "arguments": "{}" }),
                json!({ "type": "function_call_output", "call_id": "call_a", "output": "done" }),
            ]
        );
    }
}

#[cfg(test)]
mod image_tests {
    use super::*;

    #[test]
    fn builds_image_request_body_with_expected_fields() {
        let options = ImageGenerateOptions {
            size: "1024x1024".into(),
            quality: "auto".into(),
            background: "auto".into(),
            output_format: "png".into(),
        };
        let body = build_image_request_body("gpt-image-2.5-flare", "a cat", &options);
        assert_eq!(body["model"], "gpt-image-2.5-flare");
        assert_eq!(body["prompt"], "a cat");
        assert_eq!(body["size"], "1024x1024");
        assert_eq!(body["quality"], "auto");
        assert_eq!(body["background"], "auto");
        assert_eq!(body["output_format"], "png");
        assert_eq!(body["n"], 1);
    }
}

/// Chat Completions-style tool definitions (`{type, function: {...}}`, the shape of
/// `resources/contracts/tools.json`) flattened into the Responses API shape.
fn responses_tools(tools: &Value) -> Vec<Value> {
    let Some(defs) = tools.as_array() else {
        return Vec::new();
    };
    defs.iter()
        .filter_map(|def| {
            let function = def.get("function")?;
            Some(json!({
                "type": "function",
                "name": function.get("name")?,
                "description": function.get("description").cloned().unwrap_or(Value::Null),
                "parameters": function.get("parameters").cloned().unwrap_or_else(|| json!({ "type": "object", "properties": {} })),
                "strict": false
            }))
        })
        .collect()
}

/// Convert the internal message list into Responses API `input` items.
fn responses_input(messages: &[ChatMessageParam]) -> Vec<Value> {
    let mut input = Vec::new();
    for message in messages {
        if message.role == "tool" {
            input.push(json!({
                "type": "function_call_output",
                "call_id": message.tool_call_id.clone().unwrap_or_default(),
                "output": message.content.clone().unwrap_or_default()
            }));
            continue;
        }
        if let Some(items) = &message.response_items {
            input.extend(items.iter().cloned());
            continue;
        }
        let content = message.content.as_deref().unwrap_or("");
        let tool_calls = message.tool_calls.as_deref().unwrap_or(&[]);
        if !content.is_empty() || (message.role != "assistant" && tool_calls.is_empty()) {
            input.push(json!({ "role": message.role, "content": content }));
        }
        for call in tool_calls {
            input.push(json!({
                "type": "function_call",
                "call_id": call.id,
                "name": call.function.name,
                "arguments": call.function.arguments
            }));
        }
    }
    input
}

/// Accumulates one streamed Responses API response.
#[derive(Debug, PartialEq)]
enum StreamDelta {
    Text(String),
    Reasoning(String),
}

#[derive(Default)]
struct ResponseStreamState {
    text: String,
    /// Reasoning summary text for this response.
    reasoning: String,
    /// Whether the current reasoning item's summary arrived as deltas.
    reasoning_streamed: bool,
    items: Vec<Value>,
    error: Option<String>,
}

impl ResponseStreamState {
    fn push_reasoning(&mut self, chunk: &str) -> Option<StreamDelta> {
        if chunk.is_empty() {
            return None;
        }
        self.reasoning.push_str(chunk);
        Some(StreamDelta::Reasoning(chunk.to_string()))
    }

    /// Apply one SSE event; returns text or reasoning to emit, if any.
    fn apply(&mut self, event: &Value) -> Option<StreamDelta> {
        match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "response.output_text.delta" | "response.refusal.delta" => {
                let delta = event.get("delta").and_then(|v| v.as_str()).unwrap_or("");
                if delta.is_empty() {
                    return None;
                }
                self.text.push_str(delta);
                Some(StreamDelta::Text(delta.to_string()))
            }
            "response.reasoning_summary_part.added" => {
                if self.reasoning.is_empty() {
                    return None;
                }
                self.push_reasoning("\n\n")
            }
            "response.reasoning_summary_text.delta" => {
                self.reasoning_streamed = true;
                let delta = event.get("delta").and_then(|v| v.as_str()).unwrap_or("");
                self.push_reasoning(delta)
            }
            "response.output_item.done" => {
                let item = event.get("item")?;
                self.items.push(item.clone());
                if item.get("type").and_then(|v| v.as_str()) != Some("reasoning") {
                    return None;
                }
                // Fall back to the finished item when no summary deltas were streamed.
                let streamed = std::mem::take(&mut self.reasoning_streamed);
                if streamed {
                    return None;
                }
                let summary = item
                    .get("summary")
                    .and_then(|v| v.as_array())
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
                            .collect::<Vec<_>>()
                            .join("\n\n")
                    })
                    .unwrap_or_default();
                if summary.is_empty() {
                    return None;
                }
                let chunk = if self.reasoning.is_empty() {
                    summary
                } else {
                    format!("\n\n{summary}")
                };
                self.push_reasoning(&chunk)
            }
            "response.completed" => {
                if let Some(output) = event.pointer("/response/output").and_then(|v| v.as_array()) {
                    if !output.is_empty() {
                        self.items = output.clone();
                    }
                }
                None
            }
            "response.failed" => {
                self.error = Some(
                    event
                        .pointer("/response/error/message")
                        .and_then(|v| v.as_str())
                        .unwrap_or("OpenAI response failed.")
                        .to_string(),
                );
                None
            }
            "error" => {
                self.error = Some(
                    event
                        .get("message")
                        .or_else(|| event.pointer("/error/message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("OpenAI stream error.")
                        .to_string(),
                );
                None
            }
            _ => None,
        }
    }

    fn tool_calls(&self) -> Vec<ToolCallParam> {
        self.items
            .iter()
            .filter(|item| item.get("type").and_then(|v| v.as_str()) == Some("function_call"))
            .filter_map(|item| {
                let call_id = item.get("call_id").and_then(|v| v.as_str())?;
                let name = item.get("name").and_then(|v| v.as_str())?;
                let arguments = item.get("arguments").and_then(|v| v.as_str()).unwrap_or("");
                Some(ToolCallParam {
                    id: call_id.to_string(),
                    call_type: "function".into(),
                    function: ToolFunctionParam {
                        name: name.to_string(),
                        arguments: if arguments.is_empty() {
                            "{}".into()
                        } else {
                            arguments.to_string()
                        },
                    },
                })
            })
            .collect()
    }
}

pub struct OpenAIChatClient {
    client: Client,
    api_key: String,
}

/// Context for one tool invocation inside an OpenAI tool round — used to
/// checkpoint gated (approval) tools so the turn can resume after restart.
#[derive(Debug, Clone)]
pub struct ToolCallExecContext {
    pub tool_call_id: String,
    pub messages_before_result: Vec<ChatMessageParam>,
    pub remaining_tool_calls: Vec<ToolCallParam>,
    pub content_so_far: String,
}

impl OpenAIChatClient {
    pub fn new(api_key: impl Into<String>) -> Result<Self, OpenAIError> {
        Ok(Self {
            client: Client::builder().timeout(Duration::from_secs(300)).build()?,
            api_key: api_key.into(),
        })
    }

    pub async fn send_message_with_tools<F, R, G, Fut>(
        &self,
        messages: Vec<ChatMessageParam>,
        tools: Value,
        on_content: F,
        on_reasoning: R,
        execute_tool: G,
        cancel: &CancellationToken,
    ) -> Result<String, OpenAIError>
    where
        F: FnMut(&str),
        R: FnMut(&str),
        G: Fn(String, Value, ToolCallExecContext) -> Fut,
        Fut: std::future::Future<Output = String>,
    {
        self.send_message_with_tools_from(
            messages,
            tools,
            String::new(),
            on_content,
            on_reasoning,
            execute_tool,
            cancel,
        )
        .await
    }

    /// Continue a tool loop from an existing message list and content prefix
    /// (used when resuming a gated approval after app restart).
    pub async fn send_message_with_tools_from<F, R, G, Fut>(
        &self,
        mut messages: Vec<ChatMessageParam>,
        tools: Value,
        initial_content: String,
        mut on_content: F,
        mut on_reasoning: R,
        execute_tool: G,
        cancel: &CancellationToken,
    ) -> Result<String, OpenAIError>
    where
        F: FnMut(&str),
        R: FnMut(&str),
        G: Fn(String, Value, ToolCallExecContext) -> Fut,
        Fut: std::future::Future<Output = String>,
    {
        let mut full_content = initial_content;
        let mut iteration = 0usize;
        let mut reasoning_emitted = false;

        loop {
            if iteration >= MAX_TOOL_CALL_ITERATIONS {
                break;
            }
            iteration += 1;

            if cancel.is_cancelled() {
                return Err(OpenAIError::Cancelled);
            }

            let mut body = json!({
                "model": openai_chat_model(),
                "input": responses_input(&messages),
                "stream": true,
                "store": false,
                "include": ["reasoning.encrypted_content"],
                "reasoning": { "effort": CHAT_REASONING_EFFORT }
            });
            let with_summary = REASONING_SUMMARY_ENABLED.load(Ordering::Relaxed);
            if with_summary {
                body["reasoning"]["summary"] = json!("auto");
            }
            let request_tools = responses_tools(&tools);
            if !request_tools.is_empty() {
                body["tools"] = Value::Array(request_tools);
                body["tool_choice"] = json!("auto");
            }

            let response = self
                .client
                .post(OPENAI_RESPONSES_URL)
                .bearer_auth(&self.api_key)
                .json(&body)
                .send()
                .await?;

            if !response.status().is_success() {
                let status = response.status();
                let detail = response.text().await.unwrap_or_default();
                if with_summary && status == reqwest::StatusCode::BAD_REQUEST && detail.contains("summary") {
                    REASONING_SUMMARY_ENABLED.store(false, Ordering::Relaxed);
                    iteration -= 1;
                    continue;
                }
                return Err(OpenAIError::Api(detail));
            }

            let mut partial = ResponseStreamState::default();
            let mut reasoning_this_round = false;
            let mut stream = response.bytes_stream();
            let mut buffer: Vec<u8> = Vec::new();

            while let Some(chunk) = stream.next().await {
                if cancel.is_cancelled() {
                    return Err(OpenAIError::Cancelled);
                }
                buffer.extend_from_slice(&chunk?);

                while let Some(pos) = buffer.windows(2).position(|w| w == b"\n\n") {
                    let raw: Vec<u8> = buffer.drain(..pos + 2).collect();
                    let event = String::from_utf8_lossy(&raw);
                    for line in event.lines() {
                        let line = line.trim();
                        if !line.starts_with("data:") {
                            continue;
                        }
                        let data = line.trim_start_matches("data:").trim();
                        let Ok(parsed) = serde_json::from_str::<Value>(data) else {
                            continue;
                        };
                        match partial.apply(&parsed) {
                            Some(StreamDelta::Text(delta)) => {
                                full_content.push_str(&delta);
                                on_content(&delta);
                            }
                            Some(StreamDelta::Reasoning(delta)) => {
                                // Separate this round's reasoning from an earlier tool round's.
                                if reasoning_emitted && !reasoning_this_round {
                                    on_reasoning("\n\n");
                                }
                                reasoning_emitted = true;
                                reasoning_this_round = true;
                                on_reasoning(&delta);
                            }
                            None => {}
                        }
                    }
                }
            }

            if let Some(message) = partial.error.take() {
                return Err(OpenAIError::Api(message));
            }

            let tool_calls = partial.tool_calls();
            if tool_calls.is_empty() {
                break;
            }

            messages.push(ChatMessageParam {
                role: "assistant".into(),
                content: if partial.text.is_empty() {
                    None
                } else {
                    Some(partial.text.clone())
                },
                tool_calls: Some(tool_calls.clone()),
                tool_call_id: None,
                response_items: Some(partial.items.clone()),
            });

            for (index, tc) in tool_calls.iter().enumerate() {
                if cancel.is_cancelled() {
                    return Err(OpenAIError::Cancelled);
                }
                let args: Value =
                    serde_json::from_str(&tc.function.arguments).unwrap_or_else(|_| json!({}));
                let ctx = ToolCallExecContext {
                    tool_call_id: tc.id.clone(),
                    messages_before_result: messages.clone(),
                    remaining_tool_calls: tool_calls[index + 1..].to_vec(),
                    content_so_far: full_content.clone(),
                };
                let result = execute_tool(tc.function.name.clone(), args, ctx).await;
                messages.push(ChatMessageParam {
                    role: "tool".into(),
                    content: Some(result),
                    tool_calls: None,
                    tool_call_id: Some(tc.id.clone()),
                    response_items: None,
                });
            }
        }

        Ok(full_content)
    }
}

pub fn map_http_cancel(err: &OpenAIError) -> bool {
    matches!(err, OpenAIError::Cancelled)
}
