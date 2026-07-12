use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::paths::get_app_state_dir;

const UI_SESSION_FILE: &str = "ui-session.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiSessionView {
    Chat,
    Settings,
    Tasks,
    Notes,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiSession {
    pub view: UiSessionView,
    pub conversation_id: Option<String>,
    pub notes_open_note_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub setup_notice_dismissed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_note_in_sticky_window: Option<bool>,
}

impl Default for UiSession {
    fn default() -> Self {
        Self {
            view: UiSessionView::Chat,
            conversation_id: None,
            notes_open_note_id: None,
            setup_notice_dismissed: Some(false),
            open_note_in_sticky_window: Some(false),
        }
    }
}

pub fn get_ui_session_path_in(app_state_dir: &Path) -> PathBuf {
    app_state_dir.join(UI_SESSION_FILE)
}

fn normalize_optional_id(value: Option<&str>) -> Option<String> {
    let trimmed = value.unwrap_or("").trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn normalize_ui_session_view(raw: Option<&str>) -> UiSessionView {
    match raw {
        Some("clippings") => UiSessionView::Notes,
        Some("chat") => UiSessionView::Chat,
        Some("settings") => UiSessionView::Settings,
        Some("tasks") => UiSessionView::Tasks,
        Some("notes") => UiSessionView::Notes,
        _ => UiSessionView::Chat,
    }
}

pub fn normalize_ui_session(raw: &serde_json::Value) -> UiSession {
    let Some(obj) = raw.as_object() else {
        return UiSession::default();
    };
    UiSession {
        view: normalize_ui_session_view(obj.get("view").and_then(|v| v.as_str())),
        conversation_id: normalize_optional_id(obj.get("conversationId").and_then(|v| v.as_str())),
        notes_open_note_id: normalize_optional_id(
            obj.get("notesOpenNoteId").and_then(|v| v.as_str()),
        ),
        setup_notice_dismissed: Some(obj.get("setupNoticeDismissed").and_then(|v| v.as_bool()).unwrap_or(false)),
        open_note_in_sticky_window: Some(
            obj.get("openNoteInStickyWindow")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        ),
    }
}

pub fn read_ui_session_from_dir(app_state_dir: &Path) -> UiSession {
    let path = get_ui_session_path_in(app_state_dir);
    if !path.exists() {
        return UiSession::default();
    }
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    normalize_ui_session(&parsed)
}

pub fn write_ui_session_to_dir(app_state_dir: &Path, session: &UiSession) -> std::io::Result<()> {
    let next = normalize_ui_session(&serde_json::to_value(session).unwrap_or_else(|_| serde_json::json!({})));
    let pretty = serde_json::to_string_pretty(&next).unwrap_or_else(|_| "{}".into());
    std::fs::write(get_ui_session_path_in(app_state_dir), pretty)
}

pub fn merge_ui_session_in_dir(
    app_state_dir: &Path,
    partial: &serde_json::Value,
) -> UiSession {
    let current = read_ui_session_from_dir(app_state_dir);
    let mut merged = serde_json::to_value(current).unwrap_or_else(|_| serde_json::json!({}));
    if let (Some(base), Some(patch)) = (merged.as_object_mut(), partial.as_object()) {
        for (key, value) in patch {
            base.insert(key.clone(), value.clone());
        }
    }
    let next = normalize_ui_session(&merged);
    let _ = write_ui_session_to_dir(app_state_dir, &next);
    next
}

pub fn get_ui_session() -> UiSession {
    read_ui_session_from_dir(&get_app_state_dir())
}

pub fn set_ui_session(partial: &serde_json::Value) -> UiSession {
    if partial.is_null() || !partial.is_object() {
        return get_ui_session();
    }
    merge_ui_session_in_dir(&get_app_state_dir(), partial)
}
