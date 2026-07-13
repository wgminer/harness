use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

use crate::memory::AppState;
use crate::notes::read_note;
use crate::paths::get_app_state_dir;

pub const STICKY_LABEL_PREFIX: &str = "sticky-";

const STICKY_STATE_FILE: &str = "sticky-notes-windows.json";
const DEFAULT_WIDTH: f64 = 420.0;
const DEFAULT_HEIGHT: f64 = 540.0;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StickyWindowEntry {
    pub note_id: String,
    pub pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StickyWindowState {
    windows: Vec<StickyWindowEntry>,
}

pub fn sticky_label(note_id: &str) -> String {
    format!("{STICKY_LABEL_PREFIX}{note_id}")
}

pub fn note_id_from_label(label: &str) -> Option<&str> {
    label.strip_prefix(STICKY_LABEL_PREFIX)
}

fn sticky_state_path(app_state_dir: &Path) -> PathBuf {
    app_state_dir.join(STICKY_STATE_FILE)
}

fn read_state(app_state_dir: &Path) -> StickyWindowState {
    let path = sticky_state_path(app_state_dir);
    if !path.exists() {
        return StickyWindowState::default();
    }
    let raw = std::fs::read_to_string(path).unwrap_or_default();
    serde_json::from_str(&raw).unwrap_or_default()
}

fn write_state(app_state_dir: &Path, state: &StickyWindowState) -> std::io::Result<()> {
    let pretty =
        serde_json::to_string_pretty(state).unwrap_or_else(|_| "{\"windows\":[]}".into());
    std::fs::write(sticky_state_path(app_state_dir), pretty)
}

pub fn capture_window_geometry(
    window: &WebviewWindow,
) -> (Option<f64>, Option<f64>, Option<f64>, Option<f64>) {
    let position = window.outer_position().ok();
    let size = window.outer_size().ok();
    (
        position.map(|p| p.x as f64),
        position.map(|p| p.y as f64),
        size.map(|s| s.width as f64),
        size.map(|s| s.height as f64),
    )
}

fn entry_from_window(window: &WebviewWindow, note_id: &str) -> StickyWindowEntry {
    let (x, y, width, height) = capture_window_geometry(window);
    let pinned = window.is_always_on_top().unwrap_or(false);
    StickyWindowEntry {
        note_id: note_id.to_string(),
        pinned,
        x,
        y,
        width,
        height,
    }
}

fn apply_geometry(window: &WebviewWindow, entry: &StickyWindowEntry) {
    if let (Some(w), Some(h)) = (entry.width, entry.height) {
        let _ = window.set_size(LogicalSize::new(w, h));
    } else {
        let _ = window.set_size(LogicalSize::new(DEFAULT_WIDTH, DEFAULT_HEIGHT));
    }
    if let (Some(x), Some(y)) = (entry.x, entry.y) {
        let _ = window.set_position(LogicalPosition::new(x, y));
    }
}

async fn note_title(state: &AppState, note_id: &str) -> Result<String, String> {
    let note = read_note(state, note_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(note
        .map(|n| n.title)
        .unwrap_or_else(|| "Untitled".into()))
}

pub async fn open_sticky_window(
    app: &AppHandle,
    state: &AppState,
    note_id: &str,
    saved: Option<&StickyWindowEntry>,
) -> Result<StickyWindowEntry, String> {
    let clean_id = note_id.trim();
    if clean_id.is_empty() {
        return Err("Note id is required.".into());
    }
    if read_note(state, clean_id)
        .await
        .map_err(|e| e.to_string())?
        .is_none()
    {
        return Err(format!("Note not found: {clean_id}"));
    }

    let label = sticky_label(clean_id);
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.show();
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        let title = note_title(state, clean_id).await?;
        let _ = existing.set_title(&title);
        return Ok(entry_from_window(&existing, clean_id));
    }

    let title = note_title(state, clean_id).await?;
    let pinned = saved.map(|entry| entry.pinned).unwrap_or(false);

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title(&title)
        .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
        .resizable(true)
        .decorations(true)
        .build()
        .map_err(|e| e.to_string())?;

    if let Some(entry) = saved {
        apply_geometry(&window, entry);
    }
    let _ = window.set_always_on_top(pinned);

    Ok(entry_from_window(&window, clean_id))
}

pub fn set_sticky_pinned(app: &AppHandle, note_id: &str, pinned: bool) -> Result<(), String> {
    let clean_id = note_id.trim();
    if clean_id.is_empty() {
        return Err("Note id is required.".into());
    }
    let label = sticky_label(clean_id);
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("Sticky window not open: {clean_id}"))?;
    window
        .set_always_on_top(pinned)
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_sticky_title(app: &AppHandle, note_id: &str, title: &str) -> Result<(), String> {
    let clean_id = note_id.trim();
    if clean_id.is_empty() {
        return Err("Note id is required.".into());
    }
    let label = sticky_label(clean_id);
    if let Some(window) = app.get_webview_window(&label) {
        window
            .set_title(title.trim())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Close the windowed note, focus main, and ask the main UI to open the note.
pub fn pop_in_sticky(app: &AppHandle, note_id: &str) -> Result<(), String> {
    let clean_id = note_id.trim();
    if clean_id.is_empty() {
        return Err("Note id is required.".into());
    }
    let label = sticky_label(clean_id);
    if let Some(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    let _ = app.emit(
        "notes-open-in-main",
        serde_json::json!({ "noteId": clean_id }),
    );
    Ok(())
}

pub fn persist_open_sticky_windows(app: &AppHandle) {
    let app_state_dir = get_app_state_dir();
    let windows = app
        .webview_windows()
        .into_iter()
        .filter_map(|(label, window)| {
            let note_id = note_id_from_label(&label)?;
            Some(entry_from_window(&window, note_id))
        })
        .collect::<Vec<_>>();
    let _ = write_state(
        &app_state_dir,
        &StickyWindowState { windows },
    );
}

pub async fn restore_sticky_windows(app: &AppHandle, state: &AppState) {
    let app_state_dir = get_app_state_dir();
    let entries: Vec<StickyWindowEntry> = read_state(&app_state_dir).windows;
    for entry in entries {
        if read_note(state, &entry.note_id)
            .await
            .ok()
            .flatten()
            .is_none()
        {
            continue;
        }
        let _ = open_sticky_window(app, state, &entry.note_id, Some(&entry)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sticky_label_round_trip() {
        let id = "abc-123";
        assert_eq!(note_id_from_label(&sticky_label(id)), Some(id));
        assert_eq!(note_id_from_label("main"), None);
    }
}
