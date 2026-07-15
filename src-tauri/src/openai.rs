use std::collections::HashMap;
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";
const OPENAI_IMAGES_GENERATIONS_URL: &str = "https://api.openai.com/v1/images/generations";

/// Max assistant↔tool round-trips per user turn. Keep in sync with iOS `OpenAIClient.maxToolCallIterations`.
pub const MAX_TOOL_CALL_ITERATIONS: usize = 10;

pub fn tool_error_result(message: impl Into<String>) -> String {
    json!({ "error": message.into() }).to_string()
}

pub fn openai_chat_model() -> String {
    std::env::var("OPENAI_CHAT_MODEL").unwrap_or_else(|_| "gpt-5.4".into())
}

pub fn openai_image_model() -> String {
    std::env::var("OPENAI_IMAGE_MODEL").unwrap_or_else(|_| "gpt-image-1".into())
}

pub fn openai_title_model() -> String {
    std::env::var("OPENAI_TITLE_MODEL").unwrap_or_else(|_| "gpt-5.4-nano".into())
}

pub fn openai_transcript_cleanup_model() -> String {
    std::env::var("OPENAI_TRANSCRIPT_CLEANUP_MODEL").unwrap_or_else(|_| "gpt-5.4-mini".into())
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessageParam {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallParam>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
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
        "max_completion_tokens": max_completion_tokens
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

pub async fn generate_image(
    api_key: &str,
    prompt: &str,
    options: &ImageGenerateOptions,
) -> Result<Vec<u8>, OpenAIError> {
    let client = Client::builder().timeout(Duration::from_secs(120)).build()?;
    let body = build_image_request_body(&openai_image_model(), prompt, options);

    let response = client
        .post(OPENAI_IMAGES_GENERATIONS_URL)
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await?;

    if !response.status().is_success() {
        let detail = response.text().await.unwrap_or_default();
        return Err(OpenAIError::Api(detail));
    }

    let parsed: Value = response.json().await?;
    let b64 = parsed
        .pointer("/data/0/b64_json")
        .and_then(|v| v.as_str())
        .ok_or_else(|| OpenAIError::Api("Missing image data in OpenAI response.".into()))?;

    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(b64)
        .map_err(|e| OpenAIError::Api(format!("Failed to decode image data: {e}")))
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
            "list_directory",
            "read_file",
            "write_file",
            "delete_file",
            "create_directory",
            "set_layout",
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
            "memory_set_fact",
            "memory_list_facts",
            "memory_search_conversations",
            "web_search",
            "get_datetime",
        ] {
            assert!(names.contains(&expected), "missing shared (also-iOS) tool: {expected}");
        }

        assert_eq!(names.len(), 21, "unexpected tool count — update this test if tools.json changed intentionally");
    }
}

#[cfg(test)]
mod streaming_accumulator_tests {
    use super::*;

    fn delta(content: Option<&str>, tool_calls: Option<Value>) -> Value {
        let mut delta = json!({});
        if let Some(text) = content {
            delta["content"] = json!(text);
        }
        if let Some(calls) = tool_calls {
            delta["tool_calls"] = calls;
        }
        json!({ "choices": [{ "delta": delta }] })
    }

    fn merge_chunks(chunks: &[Value]) -> PartialAssistantMessage {
        let mut partial = PartialAssistantMessage::default();
        for chunk in chunks {
            if let Some(delta) = chunk.pointer("/choices/0/delta") {
                partial.merge(delta);
            }
        }
        partial
    }

    #[test]
    fn accumulates_content_across_chunks() {
        let partial = merge_chunks(&[
            delta(Some("Hel"), None),
            delta(Some("lo"), None),
            delta(Some("!"), None),
        ]);
        assert_eq!(partial.content, "Hello!");
        assert!(partial.tool_calls().is_empty());
    }

    #[test]
    fn accumulates_tool_call_fields_by_index() {
        let partial = merge_chunks(&[
            delta(
                None,
                Some(json!([{
                    "index": 0,
                    "id": "call_abc",
                    "type": "function",
                    "function": { "name": "read", "arguments": "{\"path\":" }
                }])),
            ),
            delta(
                None,
                Some(json!([{
                    "index": 0,
                    "function": { "arguments": "\"/tmp\"}" }
                }])),
            ),
        ]);

        assert_eq!(partial.content, "");
        let tool_calls = partial.tool_calls();
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].id, "call_abc");
        assert_eq!(tool_calls[0].call_type, "function");
        assert_eq!(tool_calls[0].function.name, "read");
        assert_eq!(tool_calls[0].function.arguments, "{\"path\":\"/tmp\"}");
    }

    #[test]
    fn accumulates_multiple_tool_calls_in_index_order() {
        let partial = merge_chunks(&[
            delta(
                None,
                Some(json!([
                    {
                        "index": 1,
                        "id": "call_two",
                        "type": "function",
                        "function": { "name": "write", "arguments": "{}" }
                    },
                    {
                        "index": 0,
                        "id": "call_one",
                        "type": "function",
                        "function": { "name": "read", "arguments": "{}" }
                    }
                ])),
            ),
        ]);

        let tool_calls = partial.tool_calls();
        assert_eq!(tool_calls.len(), 2);
        assert_eq!(tool_calls[0].id, "call_one");
        assert_eq!(tool_calls[1].id, "call_two");
    }

    #[test]
    fn skips_incomplete_tool_calls_missing_id() {
        let partial = merge_chunks(&[delta(
            None,
            Some(json!([{
                "index": 0,
                "function": { "name": "read", "arguments": "{}" }
            }])),
        )]);

        assert!(partial.tool_calls().is_empty());
    }

    #[test]
    fn defaults_missing_arguments_to_empty_object() {
        let partial = merge_chunks(&[delta(
            None,
            Some(json!([{
                "index": 0,
                "id": "call_abc",
                "function": { "name": "task_list" }
            }])),
        )]);

        let tool_calls = partial.tool_calls();
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].function.arguments, "{}");
    }

    #[test]
    fn defaults_missing_call_type_to_function() {
        let partial = merge_chunks(&[delta(
            None,
            Some(json!([{
                "index": 0,
                "id": "call_abc",
                "function": { "name": "task_list", "arguments": "{}" }
            }])),
        )]);

        assert_eq!(partial.tool_calls()[0].call_type, "function");
    }

    #[test]
    fn merges_content_and_tool_calls_in_same_stream() {
        let partial = merge_chunks(&[
            delta(Some("Checking"), None),
            delta(
                None,
                Some(json!([{
                    "index": 0,
                    "id": "call_abc",
                    "function": { "name": "read", "arguments": "{}" }
                }])),
            ),
            delta(Some(" files"), None),
        ]);

        assert_eq!(partial.content, "Checking files");
        assert_eq!(partial.tool_calls().len(), 1);
    }

    #[test]
    fn ignores_non_object_delta() {
        let mut partial = PartialAssistantMessage::default();
        partial.merge(&json!(null));
        partial.merge(&json!("not-an-object"));
        assert_eq!(partial.content, "");
        assert!(partial.tool_calls().is_empty());
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
        let body = build_image_request_body("gpt-image-1", "a cat", &options);
        assert_eq!(body["model"], "gpt-image-1");
        assert_eq!(body["prompt"], "a cat");
        assert_eq!(body["size"], "1024x1024");
        assert_eq!(body["quality"], "auto");
        assert_eq!(body["background"], "auto");
        assert_eq!(body["output_format"], "png");
        assert_eq!(body["n"], 1);
    }
}

#[derive(Default, Clone)]
struct ToolCallPart {
    id: Option<String>,
    call_type: Option<String>,
    name: String,
    arguments: String,
}

#[derive(Default, Clone)]
struct PartialAssistantMessage {
    content: String,
    tool_call_parts: HashMap<usize, ToolCallPart>,
}

impl PartialAssistantMessage {
    fn merge(&mut self, delta: &Value) {
        let Some(delta_obj) = delta.as_object() else {
            return;
        };

        if let Some(chunk) = delta_obj.get("content").and_then(|v| v.as_str()) {
            self.content.push_str(chunk);
        }

        let Some(tool_calls) = delta_obj.get("tool_calls").and_then(|v| v.as_array()) else {
            return;
        };

        for part in tool_calls {
            let idx = part
                .get("index")
                .and_then(|v| v.as_u64())
                .unwrap_or(self.tool_call_parts.len() as u64) as usize;

            let entry = self.tool_call_parts.entry(idx).or_default();

            if let Some(id) = part.get("id").and_then(|v| v.as_str()) {
                entry.id = Some(id.to_string());
            }
            if let Some(call_type) = part.get("type").and_then(|v| v.as_str()) {
                entry.call_type = Some(call_type.to_string());
            }
            if let Some(function) = part.get("function").and_then(|v| v.as_object()) {
                if let Some(name) = function.get("name").and_then(|v| v.as_str()) {
                    entry.name.push_str(name);
                }
                if let Some(args) = function.get("arguments").and_then(|v| v.as_str()) {
                    entry.arguments.push_str(args);
                }
            }
        }
    }

    fn tool_calls(&self) -> Vec<ToolCallParam> {
        let mut indices: Vec<_> = self.tool_call_parts.keys().copied().collect();
        indices.sort_unstable();

        indices
            .into_iter()
            .filter_map(|idx| {
                let part = self.tool_call_parts.get(&idx)?;
                let id = part.id.as_ref()?;
                Some(ToolCallParam {
                    id: id.clone(),
                    call_type: part
                        .call_type
                        .clone()
                        .unwrap_or_else(|| "function".into()),
                    function: ToolFunctionParam {
                        name: part.name.clone(),
                        arguments: if part.arguments.is_empty() {
                            "{}".into()
                        } else {
                            part.arguments.clone()
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

impl OpenAIChatClient {
    pub fn new(api_key: impl Into<String>) -> Result<Self, OpenAIError> {
        Ok(Self {
            client: Client::builder().timeout(Duration::from_secs(300)).build()?,
            api_key: api_key.into(),
        })
    }

    pub async fn send_message_with_tools<F, G, Fut>(
        &self,
        mut messages: Vec<ChatMessageParam>,
        mut on_content: F,
        execute_tool: G,
        cancel: &CancellationToken,
    ) -> Result<String, OpenAIError>
    where
        F: FnMut(&str),
        G: Fn(String, Value) -> Fut,
        Fut: std::future::Future<Output = String>,
    {
        let mut full_content = String::new();
        let mut iteration = 0usize;

        loop {
            if iteration >= MAX_TOOL_CALL_ITERATIONS {
                break;
            }
            iteration += 1;

            if cancel.is_cancelled() {
                return Err(OpenAIError::Cancelled);
            }

            let body = json!({
                "model": openai_chat_model(),
                "messages": messages,
                "stream": true,
                "tools": tool_definitions(),
                "tool_choice": "auto"
            });

            let response = self
                .client
                .post(OPENAI_CHAT_COMPLETIONS_URL)
                .bearer_auth(&self.api_key)
                .json(&body)
                .send()
                .await?;

            if !response.status().is_success() {
                let detail = response.text().await.unwrap_or_default();
                return Err(OpenAIError::Api(detail));
            }

            let mut partial = PartialAssistantMessage::default();
            let mut stream = response.bytes_stream();
            let mut buffer = String::new();

            while let Some(chunk) = stream.next().await {
                if cancel.is_cancelled() {
                    return Err(OpenAIError::Cancelled);
                }
                let bytes = chunk?;
                buffer.push_str(&String::from_utf8_lossy(&bytes));

                while let Some(pos) = buffer.find("\n\n") {
                    let event: String = buffer.drain(..pos + 2).collect();
                    for line in event.lines() {
                        let line = line.trim();
                        if !line.starts_with("data:") {
                            continue;
                        }
                        let data = line.trim_start_matches("data:").trim();
                        if data == "[DONE]" {
                            break;
                        }
                        let Ok(parsed) = serde_json::from_str::<Value>(data) else {
                            continue;
                        };
                        if let Some(delta) = parsed.pointer("/choices/0/delta/content").and_then(|v| v.as_str()) {
                            if !delta.is_empty() {
                                full_content.push_str(delta);
                                on_content(delta);
                            }
                        }
                        if let Some(delta) = parsed.pointer("/choices/0/delta") {
                            partial.merge(delta);
                        }
                    }
                }
            }

            let tool_calls = partial.tool_calls();
            if tool_calls.is_empty() {
                break;
            }

            messages.push(ChatMessageParam {
                role: "assistant".into(),
                content: if partial.content.is_empty() {
                    None
                } else {
                    Some(partial.content.clone())
                },
                tool_calls: Some(tool_calls.clone()),
                tool_call_id: None,
            });

            for tc in &tool_calls {
                if cancel.is_cancelled() {
                    return Err(OpenAIError::Cancelled);
                }
                let args: Value = serde_json::from_str(&tc.function.arguments).unwrap_or_else(|_| json!({}));
                let result = execute_tool(tc.function.name.clone(), args).await;
                messages.push(ChatMessageParam {
                    role: "tool".into(),
                    content: Some(result),
                    tool_calls: None,
                    tool_call_id: Some(tc.id.clone()),
                });
            }
        }

        Ok(full_content)
    }
}

pub fn map_http_cancel(err: &OpenAIError) -> bool {
    matches!(err, OpenAIError::Cancelled)
}
