//! Task CRUD.

use serde_json::Value;
use tauri::{command, State};

use crate::state::AppState;
use crate::tasks::{clear_completed_tasks, create_task, delete_task, list_tasks, update_task};

use super::map_err;

#[command(rename_all = "camelCase")]
pub async fn tasks_list(state: State<'_, AppState>) -> Result<Value, String> {
    let payload = list_tasks(&state).await.map_err(map_err)?;
    serde_json::to_value(payload).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn tasks_create(
    state: State<'_, AppState>,
    title: String,
    tags: Option<Vec<String>>,
    status: Option<String>,
) -> Result<Value, String> {
    let args = serde_json::json!({ "title": title, "tags": tags, "status": status });
    let payload = create_task(&state, args).await.map_err(map_err)?;
    serde_json::to_value(payload).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn tasks_update(state: State<'_, AppState>, payload: Value) -> Result<Value, String> {
    let result = update_task(&state, payload).await.map_err(map_err)?;
    serde_json::to_value(result).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn tasks_delete(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let result = delete_task(&state, serde_json::json!({ "id": id }))
        .await
        .map_err(map_err)?;
    serde_json::to_value(result).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn tasks_clear_completed(state: State<'_, AppState>) -> Result<Value, String> {
    let result = clear_completed_tasks(&state).await.map_err(map_err)?;
    serde_json::to_value(result).map_err(map_err)
}
