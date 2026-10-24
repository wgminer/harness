use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

const OPENAI_IMAGES_GENERATIONS_URL: &str = "https://api.openai.com/v1/images/generations";
const OPENAI_IMAGES_EDITS_URL: &str = "https://api.openai.com/v1/images/edits";

/// Max assistant↔tool round-trips per user turn. Keep in sync with iOS `OpenAIClient.maxToolCallIterations`.
pub const MAX_TOOL_CALL_ITERATIONS: usize = 10;

/// Reasoning effort for chat-model requests. The chat model has no "none" level;
/// "low" keeps replies close to the latency of the non-reasoning default it replaced.
pub const CHAT_REASONING_EFFORT: &str = "low";

/// Reasoning effort for the small title/cleanup model, which reasons unless told not to.
pub const SMALL_MODEL_REASONING_EFFORT: &str = "none";

/// Chat and small-model calls now run on genai in `crate::llm`; re-exported here
/// until the provider switch moves their callers.
pub use crate::llm::{chat_completion_json, generate_thread_title_with_openai, OpenAIChatClient};

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

/// Context for one tool invocation inside an OpenAI tool round — used to
/// checkpoint gated (approval) tools so the turn can resume after restart.
#[derive(Debug, Clone)]
pub struct ToolCallExecContext {
    pub tool_call_id: String,
    pub messages_before_result: Vec<ChatMessageParam>,
    pub remaining_tool_calls: Vec<ToolCallParam>,
    pub content_so_far: String,
}

pub fn map_http_cancel(err: &OpenAIError) -> bool {
    matches!(err, OpenAIError::Cancelled)
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
