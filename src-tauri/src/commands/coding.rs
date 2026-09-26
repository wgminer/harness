//! Coding scope selection.

use serde_json::Value;
use tauri::{command, AppHandle, State};

use crate::memory::{get_conversation_coding_scope, set_conversation_coding_scope};
use crate::state::AppState;

use super::map_err;

#[command(rename_all = "camelCase")]
pub async fn coding_get_scope(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Value, String> {
    let scope = get_conversation_coding_scope(&state, &conversation_id)
        .await
        .map_err(map_err)?;
    serde_json::to_value(scope).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn coding_pick_project_folder(app: AppHandle) -> Result<Value, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app
        .dialog()
        .file()
        .set_title("Choose project folder")
        .blocking_pick_folder();
    let Some(file_path) = picked else {
        return Ok(Value::Null);
    };
    let path = file_path
        .into_path()
        .map_err(|e| format!("Invalid folder path: {e}"))?;
    let scope = crate::coding::pick_project_scope_from_path(path)?;
    let meta = crate::coding::meta_from_scope(&scope);
    serde_json::to_value(meta).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub fn coding_get_self_scope() -> Result<Value, String> {
    let scope = crate::coding::use_self_scope()?;
    let meta = crate::coding::meta_from_scope(&scope);
    serde_json::to_value(meta).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn coding_set_scope(
    state: State<'_, AppState>,
    conversation_id: String,
    scope: Option<crate::coding::scope::CodingScopeMeta>,
) -> Result<(), String> {
    if let Some(ref meta) = scope {
        // Validate before persisting.
        crate::coding::scope_from_meta(meta)?;
    }
    set_conversation_coding_scope(&state, &conversation_id, scope)
        .await
        .map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub fn coding_self_scope_available() -> bool {
    crate::coding::self_available()
}
