//! Per-conversation terminal sessions.

use std::path::PathBuf;

use serde_json::Value;
use tauri::{command, AppHandle, State};

use crate::memory::get_conversation_coding_scope;
use crate::state::AppState;
use crate::terminal::TerminalRuntime;

use super::map_err;

/// The conversation's coding scope root, or the home folder when it has none.
async fn terminal_cwd(state: &AppState, conversation_id: &str) -> PathBuf {
    let scope_root = get_conversation_coding_scope(state, conversation_id)
        .await
        .ok()
        .flatten()
        .map(|meta| PathBuf::from(meta.root))
        .filter(|root| root.is_dir());
    scope_root
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("/"))
}

#[command(rename_all = "camelCase")]
pub async fn terminal_open(
    app: AppHandle,
    state: State<'_, AppState>,
    terminals: State<'_, TerminalRuntime>,
    conversation_id: String,
    cols: u16,
    rows: u16,
) -> Result<Value, String> {
    let cwd = terminal_cwd(&state, &conversation_id).await;
    let snapshot = terminals.open(&app, &conversation_id, &cwd, cols, rows)?;
    serde_json::to_value(snapshot).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub fn terminal_write(
    terminals: State<'_, TerminalRuntime>,
    conversation_id: String,
    data: String,
) -> Result<(), String> {
    terminals.write(&conversation_id, &data)
}

#[command(rename_all = "camelCase")]
pub fn terminal_resize(
    terminals: State<'_, TerminalRuntime>,
    conversation_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    terminals.resize(&conversation_id, cols, rows)
}

#[command(rename_all = "camelCase")]
pub fn terminal_close(terminals: State<'_, TerminalRuntime>, conversation_id: String) {
    terminals.close(&conversation_id);
}
