//! Capture inbox: things captured on the phone that wait to be processed on the desktop.
//!
//! The phone writes each capture to R2 as `<prefix>inbox/<id>/<attachment>` objects followed by
//! one `<prefix>inbox/<id>.json` envelope. The envelope is written last, so its presence means the
//! capture is complete. The desktop drains: download, store locally, delete the remote objects.
//! Nothing is merged, and the local store stays outside the sync bundle.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::notes::create_note;
use crate::paths::get_local_data_dir;
use crate::state::AppState;
use crate::storage::{atomic_write_utf8_unlocked, with_path_lock};
use crate::sync::remote_store::RemoteBackupStore;
use crate::tasks::create_task;

const CONTRACT_JSON: &str = include_str!("../../resources/contracts/capture.json");

pub const INBOX_CHANGED_EVENT: &str = "inbox-changed";

const INBOX_DIR: &str = "inbox";
const INBOX_FILE: &str = "inbox.json";
const ATTACHMENTS_DIR: &str = "attachments";
const MAX_SEGMENT_LEN: usize = 128;
const TASK_TITLE_MAX_CHARS: usize = 200;

/// Shared with iOS via `resources/contracts/capture.json`.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureContract {
    pub version: u32,
    pub remote_dir: String,
    pub envelope_suffix: String,
    pub kinds: Vec<String>,
    pub attachment_roles: Vec<String>,
    pub max_text_chars: usize,
    pub max_attachment_bytes: u64,
    pub max_attachments: usize,
}

pub fn contract() -> &'static CaptureContract {
    static CONTRACT: std::sync::OnceLock<CaptureContract> = std::sync::OnceLock::new();
    CONTRACT
        .get_or_init(|| serde_json::from_str(CONTRACT_JSON).expect("capture.json contract must parse"))
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureEnvelope {
    pub version: u32,
    pub id: String,
    pub kind: String,
    pub created_at: i64,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub attachments: Vec<EnvelopeAttachment>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvelopeAttachment {
    pub name: String,
    pub role: String,
    #[serde(default)]
    pub mime_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxAttachment {
    pub name: String,
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
    pub bytes: u64,
    /// Absolute path of the downloaded file on this machine.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    pub id: String,
    pub kind: String,
    pub created_at: i64,
    pub received_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default)]
    pub attachments: Vec<InboxAttachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processed_at: Option<i64>,
    /// `task`, `note`, `chat`, or `dismissed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub processed_as: Option<String>,
    /// Id of the task or note the capture became.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_id: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct InboxState {
    #[serde(default)]
    items: Vec<InboxItem>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOutcome {
    pub items: Vec<InboxItem>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_id: Option<String>,
}

fn inbox_dir() -> PathBuf {
    get_local_data_dir().join(INBOX_DIR)
}

fn inbox_file() -> PathBuf {
    inbox_dir().join(INBOX_FILE)
}

fn attachments_dir(id: &str) -> PathBuf {
    inbox_dir().join(ATTACHMENTS_DIR).join(id)
}

/// Ids and attachment names come from the remote and become local path segments.
fn is_safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment.len() <= MAX_SEGMENT_LEN
        && !segment.starts_with('.')
        && segment
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn truncate_chars(text: &str, max: usize) -> String {
    match text.char_indices().nth(max) {
        Some((end, _)) => text[..end].to_string(),
        None => text.to_string(),
    }
}

/// Validate an envelope read from `<remoteDir><expected_id><suffix>`.
pub fn parse_envelope(bytes: &[u8], expected_id: &str) -> Result<CaptureEnvelope, String> {
    let contract = contract();
    let mut envelope: CaptureEnvelope =
        serde_json::from_slice(bytes).map_err(|e| format!("invalid capture envelope: {e}"))?;
    if envelope.version == 0 || envelope.version > contract.version {
        return Err(format!("unsupported capture version {}", envelope.version));
    }
    if envelope.id != expected_id || !is_safe_segment(&envelope.id) {
        return Err("capture id does not match its object key".into());
    }
    if !contract.kinds.contains(&envelope.kind) {
        return Err(format!("unknown capture kind {}", envelope.kind));
    }
    if envelope.attachments.len() > contract.max_attachments {
        return Err("too many attachments".into());
    }
    for attachment in &envelope.attachments {
        if !is_safe_segment(&attachment.name) {
            return Err(format!("unsafe attachment name {}", attachment.name));
        }
        if !contract.attachment_roles.contains(&attachment.role) {
            return Err(format!("unknown attachment role {}", attachment.role));
        }
    }
    if let Some(text) = &envelope.text {
        envelope.text = Some(truncate_chars(text, contract.max_text_chars));
    }
    Ok(envelope)
}

async fn read_state() -> InboxState {
    match tokio::fs::read(inbox_file()).await {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => InboxState::default(),
    }
}

fn sorted_newest_first(mut items: Vec<InboxItem>) -> Vec<InboxItem> {
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    items
}

/// Read-modify-write the store under its path lock; returns the items newest first.
async fn mutate<F, T>(state: &AppState, f: F) -> Result<(Vec<InboxItem>, T), String>
where
    F: FnOnce(&mut Vec<InboxItem>) -> Result<T, String>,
{
    let path = inbox_file();
    with_path_lock(&state.write_chains, &path, async {
        let mut inbox = read_state().await;
        let out = f(&mut inbox.items)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
        }
        let data = serde_json::to_string_pretty(&inbox).map_err(|e| e.to_string())?;
        atomic_write_utf8_unlocked(&path, &data)
            .await
            .map_err(|e| e.to_string())?;
        Ok((sorted_newest_first(inbox.items), out))
    })
    .await
}

fn find_mut<'a>(items: &'a mut [InboxItem], id: &str) -> Result<&'a mut InboxItem, String> {
    items
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| "Capture not found.".to_string())
}

pub async fn list_items() -> Vec<InboxItem> {
    sorted_newest_first(read_state().await.items)
}

pub async fn update_text(state: &AppState, id: &str, text: &str) -> Result<Vec<InboxItem>, String> {
    let text = truncate_chars(text, contract().max_text_chars);
    let (items, ()) = mutate(state, |items| {
        find_mut(items, id)?.text = text;
        Ok(())
    })
    .await?;
    Ok(items)
}

pub async fn restore_item(state: &AppState, id: &str) -> Result<Vec<InboxItem>, String> {
    let (items, ()) = mutate(state, |items| {
        let item = find_mut(items, id)?;
        item.processed_at = None;
        item.processed_as = None;
        item.result_id = None;
        Ok(())
    })
    .await?;
    Ok(items)
}

/// Delete processed captures and their downloaded attachments.
pub async fn clear_processed(state: &AppState) -> Result<Vec<InboxItem>, String> {
    let (items, removed) = mutate(state, |items| {
        let (done, pending): (Vec<_>, Vec<_>) =
            items.drain(..).partition(|item| item.processed_at.is_some());
        *items = pending;
        Ok(done)
    })
    .await?;
    for item in removed {
        let _ = tokio::fs::remove_dir_all(attachments_dir(&item.id)).await;
    }
    Ok(items)
}

fn first_line(text: &str) -> Option<&str> {
    text.lines().map(str::trim).find(|line| !line.is_empty())
}

fn task_title(item: &InboxItem) -> String {
    let title = first_line(&item.text)
        .or(item.title.as_deref().and_then(first_line))
        .or(item.url.as_deref().and_then(first_line))
        .map(str::to_string)
        .unwrap_or_else(|| format!("Captured {}", item.kind));
    truncate_chars(&title, TASK_TITLE_MAX_CHARS)
}

fn note_body(item: &InboxItem) -> String {
    let mut parts: Vec<String> = Vec::new();
    let text = item.text.trim();
    if !text.is_empty() {
        parts.push(text.to_string());
    }
    if let Some(url) = item.url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        if !text.contains(url) {
            parts.push(match item.title.as_deref().map(str::trim).filter(|t| !t.is_empty()) {
                Some(title) => format!("[{title}]({url})"),
                None => url.to_string(),
            });
        }
    }
    parts.join("\n\n")
}

/// Turn a capture into a task or note, or mark it handed to chat / dismissed.
/// Processed captures stay in the store until [`clear_processed`].
pub async fn process_item(state: &AppState, id: &str, action: &str) -> Result<ProcessOutcome, String> {
    let item = list_items()
        .await
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| "Capture not found.".to_string())?;

    let result_id = match action {
        "task" => {
            let payload = create_task(state, json!({ "title": task_title(&item) }))
                .await
                .map_err(|e| e.to_string())?;
            if let Some(error) = payload.error {
                return Err(error);
            }
            payload.affected_ids.and_then(|ids| ids.into_iter().next())
        }
        "note" => {
            let note = create_note(state, None, &note_body(&item))
                .await
                .map_err(|e| e.to_string())?;
            Some(note.id)
        }
        "chat" | "dismissed" => None,
        other => return Err(format!("Unknown inbox action {other}.")),
    };

    let now = chrono::Utc::now().timestamp_millis();
    let stored_result = result_id.clone();
    let (items, ()) = mutate(state, |items| {
        let item = find_mut(items, id)?;
        item.processed_at = Some(now);
        item.processed_as = Some(action.to_string());
        item.result_id = stored_result;
        Ok(())
    })
    .await?;
    Ok(ProcessOutcome { items, result_id })
}

async fn download_attachments(
    store: &RemoteBackupStore,
    remote_dir: &str,
    envelope: &CaptureEnvelope,
) -> Result<Vec<InboxAttachment>, String> {
    let dir = attachments_dir(&envelope.id);
    let mut out = Vec::new();
    for attachment in &envelope.attachments {
        let key = format!("{remote_dir}{}/{}", envelope.id, attachment.name);
        let bytes = store.get_object(&key).await?;
        if bytes.len() as u64 > contract().max_attachment_bytes {
            return Err(format!("attachment {} is too large", attachment.name));
        }
        tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
        let path = dir.join(&attachment.name);
        tokio::fs::write(&path, &bytes).await.map_err(|e| e.to_string())?;
        out.push(InboxAttachment {
            name: attachment.name.clone(),
            role: attachment.role.clone(),
            mime_type: attachment.mime_type.clone(),
            bytes: bytes.len() as u64,
            path: path.to_string_lossy().into_owned(),
        });
    }
    Ok(out)
}

async fn import_capture(
    state: &AppState,
    store: &RemoteBackupStore,
    remote_dir: &str,
    id: &str,
) -> Result<bool, String> {
    let envelope_key = format!("{remote_dir}{id}{}", contract().envelope_suffix);
    let envelope = parse_envelope(&store.get_object(&envelope_key).await?, id)?;

    let already_stored = read_state().await.items.iter().any(|item| item.id == id);
    if !already_stored {
        let attachments = match download_attachments(store, remote_dir, &envelope).await {
            Ok(attachments) => attachments,
            Err(err) => {
                let _ = tokio::fs::remove_dir_all(attachments_dir(id)).await;
                return Err(err);
            }
        };
        let item = InboxItem {
            id: envelope.id.clone(),
            kind: envelope.kind.clone(),
            created_at: envelope.created_at,
            received_at: chrono::Utc::now().timestamp_millis(),
            source: envelope.source.clone(),
            text: envelope.text.clone().unwrap_or_default(),
            url: envelope.url.clone(),
            title: envelope.title.clone(),
            attachments,
            processed_at: None,
            processed_as: None,
            result_id: None,
        };
        mutate(state, |items| {
            if !items.iter().any(|existing| existing.id == item.id) {
                items.push(item);
            }
            Ok(())
        })
        .await?;
    }

    // Stored locally: remove the remote copy, envelope last so a failed delete retries cleanly.
    for attachment in &envelope.attachments {
        let _ = store
            .delete_object(&format!("{remote_dir}{id}/{}", attachment.name))
            .await;
    }
    store.delete_object(&envelope_key).await?;
    Ok(!already_stored)
}

/// Pull every complete capture out of the remote inbox. Returns how many new items arrived.
/// A capture that fails to import is left in the remote and retried on the next drain.
pub async fn drain(state: &AppState, store: &RemoteBackupStore) -> Result<usize, String> {
    let remote_dir = store.key_for(&contract().remote_dir);
    let suffix = contract().envelope_suffix.as_str();
    let mut imported = 0;
    for key in store.list_keys(&remote_dir).await? {
        let Some(id) = envelope_id_from_key(&key, &remote_dir, suffix) else {
            continue;
        };
        if let Ok(true) = import_capture(state, store, &remote_dir, id).await {
            imported += 1;
        }
    }
    Ok(imported)
}

/// `<remote_dir><id><suffix>` -> `id`; attachment keys (`<remote_dir><id>/<name>`) are skipped.
fn envelope_id_from_key<'a>(key: &'a str, remote_dir: &str, suffix: &str) -> Option<&'a str> {
    let rest = key.strip_prefix(remote_dir)?;
    if rest.contains('/') {
        return None;
    }
    let id = rest.strip_suffix(suffix)?;
    is_safe_segment(id).then_some(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(text: &str) -> InboxItem {
        InboxItem {
            id: "cap_1".into(),
            kind: "dictation".into(),
            created_at: 1,
            received_at: 2,
            source: None,
            text: text.into(),
            url: None,
            title: None,
            attachments: Vec::new(),
            processed_at: None,
            processed_as: None,
            result_id: None,
        }
    }

    #[test]
    fn parses_a_valid_envelope() {
        let raw = br#"{"version":1,"id":"cap_1","kind":"dictation","createdAt":10,"source":"ios",
            "text":"hello","attachments":[{"name":"audio.m4a","role":"audio","mimeType":"audio/mp4","bytes":3}]}"#;
        let envelope = parse_envelope(raw, "cap_1").unwrap();
        assert_eq!(envelope.kind, "dictation");
        assert_eq!(envelope.attachments[0].name, "audio.m4a");
    }

    #[test]
    fn rejects_envelopes_that_could_escape_the_inbox() {
        let traversal = br#"{"version":1,"id":"cap_1","kind":"file","createdAt":1,
            "attachments":[{"name":"../../x","role":"file"}]}"#;
        assert!(parse_envelope(traversal, "cap_1").is_err());
        let mismatched = br#"{"version":1,"id":"other","kind":"text","createdAt":1}"#;
        assert!(parse_envelope(mismatched, "cap_1").is_err());
    }

    #[test]
    fn rejects_unknown_kind_and_newer_version() {
        let kind = br#"{"version":1,"id":"cap_1","kind":"video","createdAt":1}"#;
        assert!(parse_envelope(kind, "cap_1").is_err());
        let version = br#"{"version":99,"id":"cap_1","kind":"text","createdAt":1}"#;
        assert!(parse_envelope(version, "cap_1").is_err());
    }

    #[test]
    fn envelope_keys_exclude_attachments() {
        assert_eq!(
            envelope_id_from_key("harness/inbox/cap_1.json", "harness/inbox/", ".json"),
            Some("cap_1")
        );
        assert_eq!(
            envelope_id_from_key("harness/inbox/cap_1/audio.m4a", "harness/inbox/", ".json"),
            None
        );
        assert_eq!(
            envelope_id_from_key("harness/inbox/cap_1/meta.json", "harness/inbox/", ".json"),
            None
        );
    }

    #[test]
    fn task_title_uses_first_line_and_falls_back() {
        assert_eq!(task_title(&item("\n  Call the plumber \nmore")), "Call the plumber");
        let mut link = item("");
        link.kind = "link".into();
        link.url = Some("https://example.com".into());
        assert_eq!(task_title(&link), "https://example.com");
        assert_eq!(task_title(&item("")), "Captured dictation");
    }

    #[test]
    fn note_body_appends_link_once() {
        let mut link = item("Read later");
        link.url = Some("https://example.com".into());
        link.title = Some("Example".into());
        assert_eq!(note_body(&link), "Read later\n\n[Example](https://example.com)");
        let mut inline = item("see https://example.com");
        inline.url = Some("https://example.com".into());
        assert_eq!(note_body(&inline), "see https://example.com");
    }
}
