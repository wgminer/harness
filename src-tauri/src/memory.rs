use std::collections::HashMap;
use std::path::{Path, PathBuf};

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::env_util::{generate_id, sanitize_conversation_id};
use crate::paths::{
    cleanup_legacy_memory_dir, get_app_state_dir, get_legacy_memory_dir, get_local_data_dir,
    get_local_data_settings_path, get_recordings_dir, get_user_data_dir,
};
use crate::storage::{
    atomic_write_utf8, file_exists, read_json_array_file, read_json_object_file, new_write_chains,
    WriteChains,
};

pub const TASKS_FILE: &str = "tasks.json";
pub const CLIPPINGS_FILE: &str = "clippings.json";

const CONVERSATIONS_FILE: &str = "conversations.json";
const USER_MEMORY_FILE: &str = "user_memory.json";

const SNIPPET_CHARS_BEFORE: usize = 80;
const SNIPPET_CHARS_AFTER: usize = 120;
const SNIPPET_MAX_LINES: usize = 3;

#[derive(Clone)]
pub struct AppState {
    pub write_chains: WriteChains,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            write_chains: new_write_chains(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConversationTitleSource {
    Auto,
    User,
    Imported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConversationSessionKind {
    Dictation,
    Chat,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMeta {
    pub title: Option<String>,
    pub created_at: i64,
    #[serde(rename = "isFromChatGPT", skip_serializing_if = "Option::is_none")]
    pub is_from_chat_gpt: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub chatgpt_id: Option<String>,
    #[serde(rename = "isFromClaude", skip_serializing_if = "Option::is_none")]
    pub is_from_claude: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claude_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_source: Option<ConversationTitleSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_kind: Option<ConversationSessionKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_assistant_reply: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_messages: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub tool_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageRecord {
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendMessageMeta {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallRecord>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: Option<String>,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_kind: Option<ConversationSessionKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_assistant_reply: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_messages: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub id: String,
    pub title: Option<String>,
    pub created_at: i64,
    pub title_matched: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title_match_range: Option<[usize; 2]>,
    pub snippet: String,
    pub snippet_match_range: [i64; 2],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataStatusSnapshot {
    pub local_data_dir: String,
    pub app_state_dir: String,
    pub local_data_exists: bool,
    pub conversations_count: usize,
    pub message_files_count: usize,
    pub notes_files_count: usize,
    pub has_settings_file: bool,
    pub recordings_dir: String,
    pub recordings_local_only: bool,
    pub legacy_memory_dir: String,
    pub legacy_memory_exists: bool,
    pub sync: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PruneResult {
    pub removed: usize,
}

pub fn get_memory_dir() -> PathBuf {
    get_app_state_dir()
}

fn conversations_path(memory_dir: &Path) -> PathBuf {
    memory_dir.join(CONVERSATIONS_FILE)
}

pub fn get_messages_path_in(memory_dir: &Path, conversation_id: &str) -> PathBuf {
    let safe = sanitize_conversation_id(conversation_id);
    memory_dir.join(format!("messages_{safe}.json"))
}

fn user_memory_path(memory_dir: &Path) -> PathBuf {
    memory_dir.join(USER_MEMORY_FILE)
}

pub fn format_voice_dictation_title() -> String {
    let time = Local::now().format("%I:%M %p").to_string();
    format!("Dictation @ {time}")
}

pub async fn load_conversations_in(
    state: &AppState,
    memory_dir: &Path,
) -> HashMap<String, ConversationMeta> {
    load_conversations_map(state, memory_dir).await
}

pub async fn get_conversation_meta_for_id(
    state: &AppState,
    conversation_id: &str,
) -> Result<Option<ConversationMeta>, std::io::Error> {
    let memory_dir = get_memory_dir();
    let conv = load_conversations_map(state, &memory_dir).await;
    Ok(conv.get(conversation_id).cloned())
}

pub async fn patch_conversation_auto_title(
    state: &AppState,
    conversation_id: &str,
    title: &str,
) -> Result<(), std::io::Error> {
    patch_conversation_meta(
        state,
        conversation_id,
        ConversationMetaPatch {
            title: Some(title.to_string()),
            title_source: Some(ConversationTitleSource::Auto),
            ..Default::default()
        },
    )
    .await
}

pub async fn pop_last_user_message(
    state: &AppState,
    conversation_id: &str,
) -> Result<Option<String>, std::io::Error> {
    let memory_dir = get_memory_dir();
    let mut messages = load_messages_in(state, &memory_dir, conversation_id).await;
    if messages.is_empty() || messages.last().map(|m| m.role.as_str()) != Some("user") {
        return Ok(None);
    }
    let content = messages.pop().unwrap().content;
    save_messages_in(state, &memory_dir, conversation_id, &messages).await?;
    Ok(Some(content))
}

pub async fn get_user_memory_in(
    _state: &AppState,
    memory_dir: &Path,
) -> Result<HashMap<String, String>, std::io::Error> {
    let path = user_memory_path(memory_dir);
    if !file_exists(&path).await {
        return Ok(HashMap::new());
    }
    let parsed = read_json_object_file(&path).await;
    let mut out = HashMap::new();
    if let Some(obj) = parsed.value.as_object() {
        for (key, value) in obj {
            if let Some(text) = value.as_str() {
                out.insert(key.clone(), text.to_string());
            }
        }
    }
    Ok(out)
}

pub async fn set_user_memory_in(
    state: &AppState,
    memory_dir: &Path,
    key: &str,
    value: &str,
) -> Result<(), std::io::Error> {
    let mut mem = get_user_memory_in(state, memory_dir).await?;
    mem.insert(key.to_string(), value.to_string());
    let path = user_memory_path(memory_dir);
    let json_value = serde_json::to_value(&mem).unwrap_or_else(|_| json!({}));
    let pretty = serde_json::to_string_pretty(&json_value).unwrap_or_else(|_| "{}".into());
    atomic_write_utf8(&state.write_chains, &path, &pretty).await
}

async fn load_conversations_map(
    _state: &AppState,
    memory_dir: &Path,
) -> HashMap<String, ConversationMeta> {
    let path = conversations_path(memory_dir);
    let parsed = read_json_object_file(&path).await;
    let mut out = HashMap::new();
    if let Some(obj) = parsed.value.as_object() {
        for (id, value) in obj {
            if let Ok(meta) = serde_json::from_value::<ConversationMeta>(value.clone()) {
                out.insert(id.clone(), meta);
            }
        }
    }
    out
}

async fn save_conversations_map(
    state: &AppState,
    memory_dir: &Path,
    conv: &HashMap<String, ConversationMeta>,
) -> std::io::Result<()> {
    let path = conversations_path(memory_dir);
    let value = serde_json::to_value(conv).unwrap_or_else(|_| json!({}));
    let pretty = serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".into());
    atomic_write_utf8(&state.write_chains, &path, &pretty).await
}

pub async fn load_messages_in(
    _state: &AppState,
    memory_dir: &Path,
    conversation_id: &str,
) -> Vec<MessageRecord> {
    let path = get_messages_path_in(memory_dir, conversation_id);
    read_json_array_file::<MessageRecord>(&path).await
}

async fn save_messages_in(
    state: &AppState,
    memory_dir: &Path,
    conversation_id: &str,
    messages: &[MessageRecord],
) -> std::io::Result<()> {
    let path = get_messages_path_in(memory_dir, conversation_id);
    let pretty = serde_json::to_string_pretty(messages).unwrap_or_else(|_| "[]".into());
    atomic_write_utf8(&state.write_chains, &path, &pretty).await
}

pub async fn create_conversation(state: &AppState) -> Result<String, std::io::Error> {
    let memory_dir = get_memory_dir();
    let id = generate_id("conv");
    let mut conv = load_conversations_map(state, &memory_dir).await;
    conv.insert(
        id.clone(),
        ConversationMeta {
            title: None,
            created_at: chrono::Utc::now().timestamp_millis(),
            is_from_chat_gpt: None,
            chatgpt_id: None,
            is_from_claude: None,
            claude_id: None,
            title_source: None,
            session_kind: Some(ConversationSessionKind::Chat),
            has_assistant_reply: None,
            has_messages: None,
        },
    );
    save_conversations_map(state, &memory_dir, &conv).await?;
    save_messages_in(state, &memory_dir, &id, &[]).await?;
    Ok(id)
}

pub async fn get_conversation(
    state: &AppState,
    id: &str,
) -> Result<Option<ConversationSummary>, std::io::Error> {
    let memory_dir = get_memory_dir();
    let conv = load_conversations_map(state, &memory_dir).await;
    Ok(conv.get(id).map(|c| ConversationSummary {
        id: id.to_string(),
        title: c.title.clone(),
        created_at: c.created_at,
        session_kind: c.session_kind,
        has_assistant_reply: c.has_assistant_reply,
        has_messages: c.has_messages,
    }))
}

pub async fn list_conversations(state: &AppState) -> Result<Vec<ConversationSummary>, std::io::Error> {
    let memory_dir = get_memory_dir();
    let conv = load_conversations_map(state, &memory_dir).await;
    let mut rows: Vec<ConversationSummary> = conv
        .into_iter()
        .map(|(id, c)| ConversationSummary {
            id,
            title: c.title,
            created_at: c.created_at,
            session_kind: c.session_kind,
            has_assistant_reply: c.has_assistant_reply,
            has_messages: c.has_messages,
        })
        .collect();
    rows.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(rows)
}

pub async fn get_messages(
    state: &AppState,
    conversation_id: &str,
) -> Result<Vec<MessageRecord>, std::io::Error> {
    Ok(load_messages_in(state, &get_memory_dir(), conversation_id).await)
}

pub async fn append_message(
    state: &AppState,
    conversation_id: &str,
    role: &str,
    content: &str,
    options: Option<AppendMessageMeta>,
) -> Result<(), std::io::Error> {
    let memory_dir = get_memory_dir();
    let mut messages = load_messages_in(state, &memory_dir, conversation_id).await;
    let mut record = MessageRecord {
        role: role.to_string(),
        content: content.to_string(),
        tool_calls: None,
        timestamp: None,
        model: None,
    };
    if let Some(meta) = options {
        if let Some(tool_calls) = meta.tool_calls.filter(|t| !t.is_empty()) {
            record.tool_calls = Some(tool_calls);
        }
        if let Some(timestamp) = meta.timestamp {
            record.timestamp = Some(timestamp);
        }
        if let Some(model) = meta.model.filter(|m| !m.is_empty()) {
            record.model = Some(model);
        }
    }

    let was_empty = messages.is_empty();
    messages.push(record);
    save_messages_in(state, &memory_dir, conversation_id, &messages).await?;

    let needs_has_messages = was_empty;
    let needs_assistant_reply = role == "assistant";
    if needs_has_messages || needs_assistant_reply {
        let mut conv = load_conversations_map(state, &memory_dir).await;
        if let Some(meta) = conv.get_mut(conversation_id) {
            let mut changed = false;
            if needs_has_messages && meta.has_messages != Some(true) {
                meta.has_messages = Some(true);
                changed = true;
            }
            if needs_assistant_reply && meta.has_assistant_reply != Some(true) {
                meta.has_assistant_reply = Some(true);
                changed = true;
            }
            if changed {
                save_conversations_map(state, &memory_dir, &conv).await?;
            }
        }
    }

    Ok(())
}

pub async fn delete_conversation(state: &AppState, conversation_id: &str) -> Result<(), std::io::Error> {
    let memory_dir = get_memory_dir();
    let mut conv = load_conversations_map(state, &memory_dir).await;
    if conv.remove(conversation_id).is_none() {
        return Ok(());
    }
    save_conversations_map(state, &memory_dir, &conv).await?;
    let messages_path = get_messages_path_in(&memory_dir, conversation_id);
    if file_exists(&messages_path).await {
        tokio::fs::remove_file(messages_path).await?;
    }
    crate::dictation_recording_index::unlink(conversation_id);
    Ok(())
}

pub async fn get_user_memory(_state: &AppState) -> Result<HashMap<String, String>, std::io::Error> {
    let memory_dir = get_memory_dir();
    let path = user_memory_path(&memory_dir);
    if !file_exists(&path).await {
        return Ok(HashMap::new());
    }
    let parsed = read_json_object_file(&path).await;
    let mut out = HashMap::new();
    if let Some(obj) = parsed.value.as_object() {
        for (key, value) in obj {
            if let Some(text) = value.as_str() {
                out.insert(key.clone(), text.to_string());
            }
        }
    }
    Ok(out)
}

pub async fn set_user_memory(
    state: &AppState,
    key: &str,
    value: &str,
) -> Result<(), std::io::Error> {
    let memory_dir = get_memory_dir();
    let mut mem = get_user_memory(state).await?;
    mem.insert(key.to_string(), value.to_string());
    let path = user_memory_path(&memory_dir);
    let json_value = serde_json::to_value(&mem).unwrap_or_else(|_| json!({}));
    let pretty = serde_json::to_string_pretty(&json_value).unwrap_or_else(|_| "{}".into());
    atomic_write_utf8(&state.write_chains, &path, &pretty).await
}

pub async fn delete_user_memory_key(state: &AppState, key: &str) -> Result<(), std::io::Error> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let memory_dir = get_memory_dir();
    let mut mem = get_user_memory(state).await?;
    if mem.remove(trimmed).is_none() {
        return Ok(());
    }
    let path = user_memory_path(&memory_dir);
    if mem.is_empty() {
        if file_exists(&path).await {
            tokio::fs::remove_file(path).await?;
        }
    } else {
        let json_value = serde_json::to_value(&mem).unwrap_or_else(|_| json!({}));
        let pretty = serde_json::to_string_pretty(&json_value).unwrap_or_else(|_| "{}".into());
        atomic_write_utf8(&state.write_chains, &path, &pretty).await?;
    }
    Ok(())
}

pub fn extract_snippet(
    content: &str,
    query_lower: &str,
    match_index: usize,
) -> (String, [usize; 2]) {
    let window_start = match_index.saturating_sub(SNIPPET_CHARS_BEFORE);
    let match_end_in_content = match_index + query_lower.len();
    let window_end = (match_end_in_content + SNIPPET_CHARS_AFTER).min(content.len());
    let mut snippet_start = window_start;
    let mut snippet_end = window_end;

    if let Some(last_newline_before) = content[..match_index.min(content.len())].rfind('\n') {
        if last_newline_before >= window_start {
            snippet_start = last_newline_before + 1;
        }
    }
    if match_end_in_content < content.len() {
        if let Some(next_newline_after) = content[match_end_in_content..].find('\n') {
            let idx = match_end_in_content + next_newline_after;
            if idx <= window_end {
                snippet_end = idx + 1;
            }
        }
    }

    let mut line_count = 1usize;
    for ch in content[snippet_start..snippet_end].chars() {
        if ch == '\n' {
            line_count += 1;
        }
        if line_count >= SNIPPET_MAX_LINES {
            break;
        }
    }
    if line_count >= SNIPPET_MAX_LINES {
        let first = content[snippet_start..].find('\n').map(|i| snippet_start + i);
        if let Some(first_nl) = first {
            if let Some(second_nl) = content[first_nl + 1..].find('\n') {
                let end = first_nl + 1 + second_nl + 1;
                if end < snippet_end {
                    snippet_end = end;
                }
            }
        }
    }

    let snippet = content[snippet_start..snippet_end].to_string();
    let match_start_in_snippet = match_index.saturating_sub(snippet_start);
    let match_end_in_snippet = match_start_in_snippet + query_lower.len();
    let clamped_start = match_start_in_snippet.min(snippet.len());
    let clamped_end = clamped_start.max(match_end_in_snippet.min(snippet.len()));
    (snippet, [clamped_start, clamped_end])
}

pub async fn search_conversations(
    state: &AppState,
    query: &str,
    compose_first_only: bool,
) -> Result<Vec<SearchResult>, std::io::Error> {
    let raw = query.trim();
    let q = raw.to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    let memory_dir = get_memory_dir();
    let conv = load_conversations_map(state, &memory_dir).await;
    let mut results = Vec::new();

    for (id, meta) in conv {
        if compose_first_only && meta.has_messages != Some(true) {
            continue;
        }
        let title_str = meta.title.clone().unwrap_or_default();
        let title_matched = title_str.to_lowercase().contains(&q);
        let title_match_range = if title_matched {
            let idx = title_str.to_lowercase().find(&q).unwrap_or(0);
            Some([idx, idx + q.len()])
        } else {
            None
        };

        let messages = load_messages_in(state, &memory_dir, &id).await;
        let mut snippet = String::new();
        let mut snippet_match_range = [-1i64, -1i64];
        let mut content_matched = false;

        for msg in &messages {
            let lower = msg.content.to_lowercase();
            if let Some(idx) = lower.find(&q) {
                content_matched = true;
                let (s, range) = extract_snippet(&msg.content, &q, idx);
                snippet = s;
                snippet_match_range = [range[0] as i64, range[1] as i64];
                break;
            }
        }

        if !title_matched && !content_matched {
            continue;
        }

        if !content_matched {
            let first = messages.first().map(|m| m.content.as_str()).unwrap_or("");
            let lines: Vec<&str> = first.lines().take(SNIPPET_MAX_LINES).collect();
            snippet = lines.join("\n").trim().to_string();
            if snippet.is_empty() {
                snippet = "No message content".into();
            }
            snippet_match_range = [-1, -1];
        }

        results.push(SearchResult {
            id,
            title: if title_str.is_empty() {
                None
            } else {
                Some(title_str)
            },
            created_at: meta.created_at,
            title_matched,
            title_match_range,
            snippet,
            snippet_match_range,
        });
    }

    results.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(results)
}

pub async fn prune_empty_conversations(state: &AppState) -> Result<PruneResult, std::io::Error> {
    let memory_dir = get_memory_dir();
    let mut conv = load_conversations_map(state, &memory_dir).await;
    let mut removed = 0usize;
    let mut changed = false;

    let ids: Vec<String> = conv.keys().cloned().collect();
    for id in ids {
        let messages = load_messages_in(state, &memory_dir, &id).await;
        if messages.is_empty() {
            conv.remove(&id);
            let messages_path = get_messages_path_in(&memory_dir, &id);
            if file_exists(&messages_path).await {
                tokio::fs::remove_file(messages_path).await?;
            }
            removed += 1;
            changed = true;
            continue;
        }
        if let Some(meta) = conv.get_mut(&id) {
            if meta.has_messages != Some(true) {
                meta.has_messages = Some(true);
                changed = true;
            }
        }
    }

    if changed {
        save_conversations_map(state, &memory_dir, &conv).await?;
    }
    Ok(PruneResult { removed })
}

fn default_sync_status() -> Value {
    json!({
        "provider": "s3Backup",
        "configured": false,
        "accountId": null,
        "bucket": null,
        "prefix": null,
        "lastAttemptAt": null,
        "lastSuccessAt": null,
        "lastError": null,
        "lastAction": null,
        "lastSyncedRevision": null,
        "remoteRevision": null,
        "statusLine": null
    })
}

pub async fn get_data_status(state: &AppState) -> Result<DataStatusSnapshot, std::io::Error> {
    let app_state_dir = get_memory_dir();
    let conv = load_conversations_map(state, &app_state_dir).await;

    let app_state_files = if app_state_dir.exists() {
        let mut files = Vec::new();
        let mut entries = tokio::fs::read_dir(&app_state_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            if let Ok(name) = entry.file_name().into_string() {
                files.push(name);
            }
        }
        files
    } else {
        Vec::new()
    };

    let note_dir = app_state_dir.join("notes");
    let notes_files = if note_dir.exists() {
        let mut files = Vec::new();
        let mut entries = tokio::fs::read_dir(&note_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            if let Ok(name) = entry.file_name().into_string() {
                files.push(name);
            }
        }
        files
    } else {
        Vec::new()
    };

    let local_data_dir = get_local_data_dir();
    let legacy_memory_dir = get_legacy_memory_dir();

    Ok(DataStatusSnapshot {
        local_data_dir: local_data_dir.display().to_string(),
        app_state_dir: app_state_dir.display().to_string(),
        local_data_exists: local_data_dir.exists(),
        conversations_count: conv.len(),
        message_files_count: app_state_files
            .iter()
            .filter(|name| name.starts_with("messages_") && name.ends_with(".json"))
            .count(),
        notes_files_count: notes_files.iter().filter(|name| name.ends_with(".md")).count(),
        has_settings_file: get_local_data_settings_path().exists(),
        recordings_dir: get_recordings_dir().display().to_string(),
        recordings_local_only: true,
        legacy_memory_dir: legacy_memory_dir.display().to_string(),
        legacy_memory_exists: legacy_memory_dir.exists(),
        sync: default_sync_status(),
    })
}

pub async fn open_app_data_folder() -> Result<(), std::io::Error> {
    let path = get_user_data_dir();
    open_path_in_file_manager(&path)
}

pub async fn cleanup_legacy_memory() -> Result<bool, std::io::Error> {
    Ok(cleanup_legacy_memory_dir())
}

pub async fn set_conversation_title(
    state: &AppState,
    conversation_id: &str,
    title: &str,
) -> Result<(), std::io::Error> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    patch_conversation_meta(
        state,
        conversation_id,
        ConversationMetaPatch {
            title: Some(trimmed.to_string()),
            title_source: Some(ConversationTitleSource::User),
            ..Default::default()
        },
    )
    .await
}

pub async fn mark_voice_dictation_session(
    state: &AppState,
    conversation_id: &str,
) -> Result<String, std::io::Error> {
    let title = format_voice_dictation_title();
    patch_conversation_meta(
        state,
        conversation_id,
        ConversationMetaPatch {
            title: Some(title.clone()),
            title_source: Some(ConversationTitleSource::Auto),
            session_kind: Some(ConversationSessionKind::Dictation),
            ..Default::default()
        },
    )
    .await?;
    Ok(title)
}

#[derive(Default)]
struct ConversationMetaPatch {
    title: Option<String>,
    title_source: Option<ConversationTitleSource>,
    session_kind: Option<ConversationSessionKind>,
    has_assistant_reply: Option<bool>,
    has_messages: Option<bool>,
}

async fn patch_conversation_meta(
    state: &AppState,
    conversation_id: &str,
    patch: ConversationMetaPatch,
) -> Result<(), std::io::Error> {
    let memory_dir = get_memory_dir();
    let mut conv = load_conversations_map(state, &memory_dir).await;
    let Some(meta) = conv.get_mut(conversation_id) else {
        return Ok(());
    };
    if let Some(title) = patch.title {
        meta.title = Some(title);
    }
    if let Some(title_source) = patch.title_source {
        meta.title_source = Some(title_source);
    }
    if let Some(session_kind) = patch.session_kind {
        meta.session_kind = Some(session_kind);
    }
    if let Some(has_assistant_reply) = patch.has_assistant_reply {
        meta.has_assistant_reply = Some(has_assistant_reply);
    }
    if let Some(has_messages) = patch.has_messages {
        meta.has_messages = Some(has_messages);
    }
    save_conversations_map(state, &memory_dir, &conv).await
}

fn open_path_in_file_manager(path: &Path) -> Result<(), std::io::Error> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map(|_| ())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map(|_| ())?;
        Ok(())
    }
}

pub fn show_item_in_folder(path: &Path) -> Result<(), std::io::Error> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map(|_| ())?;
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", path.display()))
            .spawn()
            .map(|_| ())?;
        return Ok(());
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Some(parent) = path.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map(|_| ())?;
        }
        Ok(())
    }
}
