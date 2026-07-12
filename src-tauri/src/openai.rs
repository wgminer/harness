use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

const OPENAI_CHAT_COMPLETIONS_URL: &str = "https://api.openai.com/v1/chat/completions";

pub fn openai_chat_model() -> String {
    std::env::var("OPENAI_CHAT_MODEL").unwrap_or_else(|_| "gpt-5.4".into())
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

pub fn tool_definitions() -> Value {
    json!([
      {
        "type": "function",
        "function": {
          "name": "list_directory",
          "description": "List contents of a directory (files and subdirectories). Path must be under allowed roots.",
          "parameters": {
            "type": "object",
            "properties": { "path": { "type": "string", "description": "Absolute path to the directory" } },
            "required": ["path"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "read_file",
          "description": "Read plain text content of a file. Size limit 1MB.",
          "parameters": {
            "type": "object",
            "properties": { "path": { "type": "string", "description": "Absolute path to the file" } },
            "required": ["path"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "write_file",
          "description": "Create or overwrite a file with the given content. Path must be under allowed roots.",
          "parameters": {
            "type": "object",
            "properties": {
              "path": { "type": "string", "description": "Absolute path to the file" },
              "content": { "type": "string", "description": "Content to write" }
            },
            "required": ["path", "content"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "delete_file",
          "description": "Delete a file. Path must be under allowed roots.",
          "parameters": {
            "type": "object",
            "properties": { "path": { "type": "string", "description": "Absolute path to the file" } },
            "required": ["path"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "create_directory",
          "description": "Create a directory. Path must be under allowed roots.",
          "parameters": {
            "type": "object",
            "properties": { "path": { "type": "string", "description": "Absolute path for the new directory" } },
            "required": ["path"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "set_layout",
          "description": "Change app layout: sidebar position (left/right) and optional grid overlay (off/4/8/16).",
          "parameters": {
            "type": "object",
            "properties": {
              "sidebar": { "type": "string", "enum": ["left", "right"], "description": "Sidebar position" },
              "gridOverlay": { "type": "string", "enum": ["off", "4", "8", "16"], "description": "Design grid overlay spacing in px" }
            }
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "task_list",
          "description": "List all persistent assistant tasks. Use this to understand current open work items before adding or changing tasks.",
          "parameters": { "type": "object", "properties": {} }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "task_create",
          "description": "Create a new persistent assistant task that will be remembered across messages. Use concise, user-facing titles.",
          "parameters": {
            "type": "object",
            "properties": {
              "title": { "type": "string", "description": "Short description of the task" },
              "status": {
                "type": "string",
                "enum": ["pending", "in_progress", "completed", "cancelled"],
                "description": "Workflow state for the task. Defaults to pending."
              },
              "tags": {
                "type": "array",
                "items": { "type": "string" },
                "description": "Optional filterable labels."
              },
              "metadata": {
                "type": "object",
                "description": "Optional extra structured information about the task."
              }
            },
            "required": ["title"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "task_update",
          "description": "Update an existing persistent assistant task.",
          "parameters": {
            "type": "object",
            "properties": {
              "id": { "type": "string", "description": "ID of the task to update" },
              "title": { "type": "string" },
              "status": { "type": "string", "enum": ["pending", "in_progress", "completed", "cancelled"] },
              "tags": { "type": "array", "items": { "type": "string" } },
              "add_tags": { "type": "array", "items": { "type": "string" } },
              "remove_tags": { "type": "array", "items": { "type": "string" } },
              "metadata": { "type": "object" }
            },
            "required": ["id"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "task_delete",
          "description": "Delete a persistent assistant task by ID when it is no longer relevant.",
          "parameters": {
            "type": "object",
            "properties": { "id": { "type": "string" } },
            "required": ["id"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "task_clear_completed",
          "description": "Remove all tasks whose status is completed or cancelled.",
          "parameters": { "type": "object", "properties": {} }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "memory_set_fact",
          "description": "Store a stable user fact or preference in persistent memory.",
          "parameters": {
            "type": "object",
            "properties": {
              "key": { "type": "string" },
              "value": { "type": "string" }
            },
            "required": ["key", "value"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "memory_list_facts",
          "description": "List all stored persistent user facts and preferences.",
          "parameters": { "type": "object", "properties": {} }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "memory_search_conversations",
          "description": "Search all prior conversations for a free-text query. Use whenever cross-thread recall, continuity, names, or prior decisions would help — not only when the user explicitly asks to search chat history.",
          "parameters": {
            "type": "object",
            "properties": { "query": { "type": "string" } },
            "required": ["query"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "get_weather",
          "description": "Get current conditions and a short daily forecast for a US ZIP code.",
          "parameters": {
            "type": "object",
            "properties": {
              "zip": { "type": "string" },
              "days": { "type": "number" }
            }
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "web_search",
          "description": "Search the web for current information via Tavily.",
          "parameters": {
            "type": "object",
            "properties": {
              "query": { "type": "string" },
              "max_results": { "type": "number" }
            },
            "required": ["query"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "note_list",
          "description": "List all persisted notes with their ids, titles, and timestamps.",
          "parameters": { "type": "object", "properties": {} }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "note_create",
          "description": "Create a new note. For long chat replies, pass title and summary (1-3 sentences shown in chat), leave content empty, then write the full body in your following output. For background notes, pass title/content without summary.",
          "parameters": {
            "type": "object",
            "properties": {
              "title": { "type": "string", "description": "Note title shown in the editor and inline preview" },
              "summary": { "type": "string", "description": "Optional 1-3 sentence summary for chat when attaching a long write-up inline" },
              "content": { "type": "string", "description": "Initial note body (usually empty when streaming a long reply)" }
            }
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "note_read",
          "description": "Read one note by id.",
          "parameters": {
            "type": "object",
            "properties": { "id": { "type": "string" } },
            "required": ["id"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "note_save",
          "description": "Replace the full markdown content of a note by id.",
          "parameters": {
            "type": "object",
            "properties": {
              "id": { "type": "string" },
              "content": { "type": "string" }
            },
            "required": ["id", "content"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "note_delete",
          "description": "Delete a note by id.",
          "parameters": {
            "type": "object",
            "properties": { "id": { "type": "string" } },
            "required": ["id"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "get_datetime",
          "description": "Get the current date and time from the app host.",
          "parameters": {
            "type": "object",
            "properties": {
              "timezone": { "type": "string", "description": "Optional IANA timezone" }
            }
          }
        }
      }
    ])
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

#[derive(Default, Clone, serde::Serialize)]
struct PartialAssistantMessage {
    content: String,
    tool_calls: Vec<ToolCallParam>,
}

fn merge_delta(acc: &mut Value, delta: &Value) {
    let Some(delta_obj) = delta.as_object() else {
        return;
    };
    for (key, value) in delta_obj {
        if value.is_null() {
            continue;
        }
        match acc.get_mut(key) {
            None => {
                acc[key] = value.clone();
            }
            Some(existing) if existing.is_string() && value.as_str().is_some() => {
                let merged = format!(
                    "{}{}",
                    existing.as_str().unwrap_or_default(),
                    value.as_str().unwrap_or_default()
                );
                acc[key] = Value::String(merged);
            }
            Some(existing) if existing.is_array() && value.is_array() => {
                let arr = existing.as_array_mut().unwrap();
                for item in value.as_array().unwrap() {
                    let idx = item
                        .get("index")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(arr.len() as u64) as usize;
                    while arr.len() <= idx {
                        arr.push(json!({}));
                    }
                    if let Some(rest) = item.as_object() {
                        let mut patch = json!({});
                        for (k, v) in rest {
                            if k != "index" {
                                patch[k] = v.clone();
                            }
                        }
                        merge_delta(&mut arr[idx], &patch);
                    }
                }
            }
            Some(existing) if existing.is_object() && value.is_object() => {
                merge_delta(existing, value);
            }
            Some(slot) => {
                *slot = value.clone();
            }
        }
    }
}

fn partial_from_delta(previous: &PartialAssistantMessage, chunk: &Value) -> PartialAssistantMessage {
    let mut acc = json!({
        "content": previous.content,
        "tool_calls": previous.tool_calls
    });
    if let Some(delta) = chunk.pointer("/choices/0/delta") {
        merge_delta(&mut acc, delta);
    }

    let content = acc
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let tool_calls = acc
        .get("tool_calls")
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|row| serde_json::from_value::<ToolCallParam>(row.clone()).ok())
                .collect()
        })
        .unwrap_or_else(|| previous.tool_calls.clone());

    PartialAssistantMessage { content, tool_calls }
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
        Fut: std::future::Future<Output = Result<String, OpenAIError>>,
    {
        let mut full_content = String::new();

        loop {
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
                        partial = partial_from_delta(&partial, &parsed);
                    }
                }
            }

            if partial.tool_calls.is_empty() {
                break;
            }

            messages.push(ChatMessageParam {
                role: "assistant".into(),
                content: if partial.content.is_empty() {
                    None
                } else {
                    Some(partial.content.clone())
                },
                tool_calls: Some(partial.tool_calls.clone()),
                tool_call_id: None,
            });

            for tc in &partial.tool_calls {
                if cancel.is_cancelled() {
                    return Err(OpenAIError::Cancelled);
                }
                let args: Value = serde_json::from_str(&tc.function.arguments).unwrap_or_else(|_| json!({}));
                let result = execute_tool(tc.function.name.clone(), args).await?;
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
