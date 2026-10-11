//! Capture inbox: list, edit, and process captures drained from the phone.

use std::sync::Arc;

use serde_json::Value;
use tauri::{command, AppHandle, State};

use crate::inbox::{clear_processed, list_items, process_item, restore_item, update_text};
use crate::state::AppState;
use crate::sync::{drain_capture_inbox, SyncRuntime};

use super::map_err;

#[command(rename_all = "camelCase")]
pub async fn inbox_list() -> Result<Value, String> {
    serde_json::to_value(list_items().await).map_err(map_err)
}

/// Drain the remote inbox now, then return the list.
#[command(rename_all = "camelCase")]
pub async fn inbox_refresh(
    runtime: State<'_, Arc<SyncRuntime>>,
    app: AppHandle,
) -> Result<Value, String> {
    drain_capture_inbox(&runtime, &app).await?;
    serde_json::to_value(list_items().await).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn inbox_update_text(
    state: State<'_, AppState>,
    id: String,
    text: String,
) -> Result<Value, String> {
    let items = update_text(&state, &id, &text).await?;
    serde_json::to_value(items).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn inbox_process(
    state: State<'_, AppState>,
    id: String,
    action: String,
) -> Result<Value, String> {
    let outcome = process_item(&state, &id, &action).await?;
    serde_json::to_value(outcome).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn inbox_restore(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let items = restore_item(&state, &id).await?;
    serde_json::to_value(items).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn inbox_clear_processed(state: State<'_, AppState>) -> Result<Value, String> {
    let items = clear_processed(&state).await?;
    serde_json::to_value(items).map_err(map_err)
}
