//! ChatGPT / Claude export folder importers.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::env_util::is_harness_e2e;
use crate::memory::{
    get_claude_id_map, import_conversations, AppState, ImportConversationItem, ImportMessage,
};

/// Claude.ai exports do not include a model id on messages; label assistant turns
/// so the chat footer has something to show.
const CLAUDE_IMPORT_MODEL_LABEL: &str = "Claude";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub updated: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeImportPreviewItem {
    pub claude_id: String,
    pub title: Option<String>,
    pub created_at: i64,
    pub message_count: usize,
    /// True when this Claude uuid is already present locally (confirm will refresh it).
    pub already_imported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeImportPreview {
    /// `None` when the user cancelled the folder picker.
    pub folder_path: Option<String>,
    pub found: usize,
    pub already_imported: usize,
    pub conversations: Vec<ClaudeImportPreviewItem>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone)]
struct ParsedMessage {
    role: String,
    content: String,
    timestamp: Option<i64>,
    model: Option<String>,
}

#[derive(Debug, Clone)]
struct ParsedConversation {
    id: String,
    title: Option<String>,
    created_at: i64,
    messages: Vec<ParsedMessage>,
}

/// Maps Claude.ai's export sender labels to our internal roles.
///
/// Claude exports use `sender: "human" | "assistant"`. Older variants and tool
/// calls also surface `"tool"` / `"system"` — we drop those to keep transcripts
/// focused on the conversation the user actually saw.
fn map_sender(sender: &Value) -> Option<&'static str> {
    let s = match sender {
        Value::String(s) => s.as_str(),
        _ => return None,
    };
    match s {
        "human" | "user" => Some("user"),
        "assistant" => Some("assistant"),
        _ => None,
    }
}

/// Anthropic switched message bodies from a flat `text` field to a `content`
/// array of blocks (`{ type: "text", text }`, `{ type: "tool_use", ... }`, etc.).
/// Real exports often include both for backwards compatibility, so we prefer
/// the structured array but fall back to `text`.
fn extract_text(message: &Value) -> String {
    if let Some(content) = message.get("content").and_then(|c| c.as_array()) {
        let mut parts: Vec<&str> = Vec::new();
        for block in content {
            if block.get("type").and_then(|t| t.as_str()) != Some("text") {
                continue;
            }
            if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                parts.push(text);
            }
        }
        if !parts.is_empty() {
            return parts.join("\n").trim().to_string();
        }
    }
    message
        .get("text")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .unwrap_or_default()
}

fn parse_timestamp(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => {
            let n = n.as_f64()?;
            if !n.is_finite() {
                return None;
            }
            Some(if n > 1e12 { n.round() as i64 } else { (n * 1000.0).round() as i64 })
        }
        Value::String(s) if !s.is_empty() => chrono::DateTime::parse_from_rfc3339(s)
            .ok()
            .map(|dt| dt.timestamp_millis())
            .or_else(|| {
                // Some exports use slightly non-RFC3339 forms; fall back to a
                // looser parse via chrono's DateTime::<Utc>::from_str when possible.
                chrono::DateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.fZ")
                    .ok()
                    .map(|dt| dt.timestamp_millis())
            }),
        _ => None,
    }
}

fn parse_claude_conversation(conv: &Value) -> Option<ParsedConversation> {
    let o = conv.as_object()?;
    let id = o
        .get("uuid")
        .or_else(|| o.get("id"))
        .or_else(|| o.get("conversation_uuid"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())?
        .to_string();

    let title = o
        .get("name")
        .or_else(|| o.get("title"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());

    let created_at = o
        .get("created_at")
        .and_then(parse_timestamp)
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());

    let mut messages: Vec<ParsedMessage> = Vec::new();
    if let Some(raw) = o
        .get("chat_messages")
        .or_else(|| o.get("messages"))
        .and_then(|m| m.as_array())
    {
        for m in raw {
            let role_value = m
                .get("sender")
                .or_else(|| m.get("role"))
                .or_else(|| m.pointer("/author/role"))
                .cloned()
                .unwrap_or(Value::Null);
            let Some(role) = map_sender(&role_value) else {
                continue;
            };
            let content = extract_text(m);
            if content.is_empty() {
                continue;
            }
            let timestamp = m
                .get("created_at")
                .and_then(parse_timestamp)
                .or_else(|| m.get("updated_at").and_then(parse_timestamp));
            let model = if role == "assistant" {
                m.get("model")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string())
                    .or_else(|| Some(CLAUDE_IMPORT_MODEL_LABEL.to_string()))
            } else {
                None
            };
            messages.push(ParsedMessage {
                role: role.to_string(),
                content,
                timestamp,
                model,
            });
        }
    }

    Some(ParsedConversation {
        id,
        title,
        created_at,
        messages,
    })
}

fn parse_claude_file(buffer: &str) -> Vec<ParsedConversation> {
    let data: Value = match serde_json::from_str(buffer) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(arr) = data.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for item in arr {
        if let Some(parsed) = parse_claude_conversation(item) {
            out.push(parsed);
        }
    }
    out
}

/// The official Anthropic "Export data" archive places all conversations in a
/// single `conversations.json` array at the root. Older variants split into
/// per-conversation files; we accept both.
const SINGLE_FILE_CANDIDATES: &[&str] = &["conversations.json", "data.json"];

fn scan_claude_folder(folder_path: &Path) -> (HashMap<String, ParsedConversation>, Vec<String>) {
    let mut errors: Vec<String> = Vec::new();
    let entries = match std::fs::read_dir(folder_path) {
        Ok(e) => e,
        Err(e) => {
            errors.push(format!("{}: {e}", folder_path.display()));
            return (HashMap::new(), errors);
        }
    };

    let mut names: Vec<String> = Vec::new();
    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    let lower: HashSet<String> = names.iter().map(|n| n.to_lowercase()).collect();
    let mut by_id: HashMap<String, ParsedConversation> = HashMap::new();

    let single_file = SINGLE_FILE_CANDIDATES
        .iter()
        .find(|name| lower.contains(**name))
        .copied();

    if let Some(file_name) = single_file {
        // Preserve the on-disk casing from the directory listing.
        let actual = names
            .iter()
            .find(|n| n.eq_ignore_ascii_case(file_name))
            .cloned()
            .unwrap_or_else(|| file_name.to_string());
        let path = folder_path.join(&actual);
        match std::fs::read_to_string(&path) {
            Ok(raw) => {
                for c in parse_claude_file(&raw) {
                    by_id.entry(c.id.clone()).or_insert(c);
                }
            }
            Err(e) => errors.push(format!("{actual}: {e}")),
        }
    }

    if by_id.is_empty() {
        let per_file = Regex::new(r"(?i)^conversation[s]?[-_]?.+\.json$").expect("static regex");
        for file in &names {
            if !per_file.is_match(file) {
                continue;
            }
            if SINGLE_FILE_CANDIDATES
                .iter()
                .any(|c| file.eq_ignore_ascii_case(c))
            {
                continue;
            }
            let path = folder_path.join(file);
            let raw = match std::fs::read_to_string(&path) {
                Ok(r) => r,
                Err(e) => {
                    errors.push(format!("{file}: {e}"));
                    continue;
                }
            };
            let list = parse_claude_file(&raw);
            if list.is_empty() {
                // The file might be a single conversation object, not an array.
                if let Ok(value) = serde_json::from_str::<Value>(&raw) {
                    if let Some(single) = parse_claude_conversation(&value) {
                        by_id.entry(single.id.clone()).or_insert(single);
                    }
                }
                continue;
            }
            for c in list {
                by_id.entry(c.id.clone()).or_insert(c);
            }
        }
    }

    if by_id.is_empty() && errors.is_empty() {
        errors.push(format!(
            "No Claude conversations found in {}. Expected conversations.json from the Claude.ai \"Export data\" archive.",
            folder_path.display()
        ));
    }

    (by_id, errors)
}

pub async fn import_from_chatgpt_folder(
    app: &AppHandle,
    _state: &AppState,
) -> Result<Value, String> {
    let dir = resolve_import_dir(app, "HARNESS_E2E_IMPORT_DIR").await?;
    let Some(dir) = dir else {
        return Ok(serde_json::json!({ "imported": 0, "errors": [] }));
    };
    // Minimal stub: scan for conversations.json files and report count.
    // Full ChatGPT import parser not yet ported to Rust.
    let mut imported = 0usize;
    let mut errors: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if std::fs::read_to_string(&path).is_ok() {
                    imported += 1;
                } else {
                    errors.push(format!("Failed to read {}", path.display()));
                }
            }
        }
    }
    Ok(serde_json::json!({ "imported": imported, "errors": errors }))
}

pub async fn preview_claude_import(
    app: &AppHandle,
    state: &AppState,
) -> Result<ClaudeImportPreview, String> {
    let dir = resolve_import_dir(app, "HARNESS_E2E_CLAUDE_IMPORT_DIR").await?;
    let Some(dir) = dir else {
        return Ok(ClaudeImportPreview {
            folder_path: None,
            found: 0,
            already_imported: 0,
            conversations: Vec::new(),
            errors: Vec::new(),
        });
    };

    let dir_clone = dir.clone();
    let (by_id, errors) =
        tokio::task::spawn_blocking(move || scan_claude_folder(&dir_clone))
            .await
            .map_err(|e| e.to_string())?;

    let existing = get_claude_id_map(state)
        .await
        .map_err(|e| e.to_string())?;

    let found = by_id.len();
    let mut already_imported = 0usize;
    let mut conversations: Vec<ClaudeImportPreviewItem> = Vec::new();
    let mut sorted: Vec<ParsedConversation> = by_id.into_values().collect();
    sorted.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    for c in sorted {
        let is_existing = existing.contains_key(&c.id);
        if is_existing {
            already_imported += 1;
        }
        conversations.push(ClaudeImportPreviewItem {
            claude_id: c.id,
            title: c.title,
            created_at: c.created_at,
            message_count: c.messages.len(),
            already_imported: is_existing,
        });
    }

    Ok(ClaudeImportPreview {
        folder_path: Some(dir.to_string_lossy().into_owned()),
        found,
        already_imported,
        conversations,
        errors,
    })
}

pub async fn confirm_claude_import(
    state: &AppState,
    folder_path: String,
    claude_ids: Option<Vec<String>>,
) -> Result<ImportResult, String> {
    let path = PathBuf::from(folder_path.trim());
    if folder_path.trim().is_empty() || !path.is_dir() {
        return Ok(ImportResult {
            imported: 0,
            updated: 0,
            errors: vec!["Import folder is missing or not a directory.".into()],
        });
    }

    let path_clone = path.clone();
    let (by_id, errors) =
        tokio::task::spawn_blocking(move || scan_claude_folder(&path_clone))
            .await
            .map_err(|e| e.to_string())?;

    let selected: Option<HashSet<String>> =
        claude_ids.map(|ids| ids.into_iter().filter(|id| !id.is_empty()).collect());

    let mut sorted: Vec<ParsedConversation> = by_id.into_values().collect();
    sorted.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    let mut items: Vec<ImportConversationItem> = Vec::new();
    for c in sorted {
        if let Some(ref sel) = selected {
            if !sel.contains(&c.id) {
                continue;
            }
        }
        items.push(ImportConversationItem {
            title: c.title,
            created_at: c.created_at,
            messages: c
                .messages
                .into_iter()
                .map(|m| ImportMessage {
                    role: m.role,
                    content: m.content,
                    timestamp: m.timestamp,
                    model: m.model,
                })
                .collect(),
            chatgpt_id: None,
            claude_id: Some(c.id),
        });
    }

    let result = import_conversations(state, items)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ImportResult {
        imported: result.imported,
        updated: result.updated,
        errors,
    })
}

async fn resolve_import_dir(app: &AppHandle, e2e_env: &str) -> Result<Option<PathBuf>, String> {
    if is_harness_e2e() {
        if let Ok(dir) = std::env::var(e2e_env) {
            if !dir.is_empty() {
                return Ok(Some(PathBuf::from(dir)));
            }
        }
    }
    let picked = app
        .dialog()
        .file()
        .set_title("Choose export folder")
        .blocking_pick_folder();
    Ok(picked.and_then(|p| p.into_path().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_sender_labels_to_internal_roles() {
        let parsed = parse_claude_conversation(&json!({
            "uuid": "c1",
            "name": "Test thread",
            "created_at": "2024-05-01T12:00:00Z",
            "chat_messages": [
                { "sender": "human", "text": "hi there", "created_at": "2024-05-01T12:00:01Z" },
                { "sender": "assistant", "text": "hello!", "created_at": "2024-05-01T12:00:02Z" },
                { "sender": "tool", "text": "ignored" },
            ],
        }))
        .expect("parsed");
        assert_eq!(parsed.id, "c1");
        assert_eq!(parsed.title.as_deref(), Some("Test thread"));
        assert_eq!(parsed.messages.len(), 2);
        assert_eq!(parsed.messages[0].role, "user");
        assert_eq!(parsed.messages[0].content, "hi there");
        assert_eq!(
            parsed.messages[0].timestamp,
            Some(
                chrono::DateTime::parse_from_rfc3339("2024-05-01T12:00:01Z")
                    .unwrap()
                    .timestamp_millis()
            )
        );
        assert_eq!(parsed.messages[0].model, None);
        assert_eq!(parsed.messages[1].role, "assistant");
        assert_eq!(parsed.messages[1].content, "hello!");
        assert_eq!(
            parsed.messages[1].model.as_deref(),
            Some(CLAUDE_IMPORT_MODEL_LABEL)
        );
    }

    #[test]
    fn prefers_structured_content_blocks() {
        let parsed = parse_claude_conversation(&json!({
            "uuid": "c2",
            "chat_messages": [{
                "sender": "human",
                "text": "fallback only",
                "content": [
                    { "type": "text", "text": "structured first" },
                    { "type": "tool_use", "name": "noop" },
                    { "type": "text", "text": "structured second" },
                ],
            }],
        }))
        .expect("parsed");
        assert_eq!(parsed.messages.len(), 1);
        assert_eq!(parsed.messages[0].content, "structured first\nstructured second");
    }

    #[test]
    fn falls_back_to_flat_text() {
        let parsed = parse_claude_conversation(&json!({
            "uuid": "c3",
            "chat_messages": [{
                "sender": "assistant",
                "text": "plain",
                "content": [{ "type": "tool_use" }],
            }],
        }))
        .expect("parsed");
        assert_eq!(parsed.messages.len(), 1);
        assert_eq!(parsed.messages[0].role, "assistant");
        assert_eq!(parsed.messages[0].content, "plain");
        assert_eq!(
            parsed.messages[0].model.as_deref(),
            Some(CLAUDE_IMPORT_MODEL_LABEL)
        );
    }

    #[test]
    fn skips_empty_messages() {
        let parsed = parse_claude_conversation(&json!({
            "uuid": "c4",
            "chat_messages": [
                { "sender": "human", "content": [] },
                { "sender": "assistant", "text": "" },
                { "sender": "human", "text": "  " },
                { "sender": "assistant", "text": "kept" },
            ],
        }))
        .expect("parsed");
        assert_eq!(parsed.messages.len(), 1);
        assert_eq!(parsed.messages[0].content, "kept");
    }

    #[test]
    fn returns_none_when_uuid_missing() {
        assert!(parse_claude_conversation(&json!({ "name": "x", "chat_messages": [] })).is_none());
        assert!(parse_claude_conversation(&Value::Null).is_none());
        assert!(parse_claude_conversation(&json!("not an object")).is_none());
    }

    #[test]
    fn parses_created_at() {
        let parsed = parse_claude_conversation(&json!({
            "uuid": "c5",
            "name": "T",
            "created_at": "2024-01-02T03:04:05Z",
            "chat_messages": [],
        }))
        .expect("parsed");
        assert_eq!(
            parsed.created_at,
            chrono::DateTime::parse_from_rfc3339("2024-01-02T03:04:05Z")
                .unwrap()
                .timestamp_millis()
        );

        // Real Claude exports use microsecond precision.
        let micro = parse_claude_conversation(&json!({
            "uuid": "c5b",
            "created_at": "2024-09-02T02:48:10.987100Z",
            "chat_messages": [],
        }))
        .expect("parsed");
        assert_eq!(
            micro.created_at,
            chrono::DateTime::parse_from_rfc3339("2024-09-02T02:48:10.987100Z")
                .unwrap()
                .timestamp_millis()
        );
    }

    #[test]
    fn parses_file_arrays_and_tolerates_invalid_json() {
        let rows = parse_claude_file(
            r#"[{"uuid":"a","name":"A","chat_messages":[]},{"uuid":"b","name":"B","chat_messages":[]}]"#,
        );
        assert_eq!(
            rows.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert!(parse_claude_file("{not-json").is_empty());
    }

    #[test]
    fn scans_single_conversations_json() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("conversations.json"),
            r#"[{"uuid":"x1","name":"One","created_at":"2024-05-01T12:00:00Z","chat_messages":[{"sender":"human","text":"hi"}]}]"#,
        )
        .unwrap();
        let (by_id, errors) = scan_claude_folder(dir.path());
        assert!(errors.is_empty());
        assert_eq!(by_id.len(), 1);
        assert!(by_id.contains_key("x1"));
    }
}
