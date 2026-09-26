//! Conversations, messages, user memory, and imports.

use serde_json::Value;
use tauri::{command, AppHandle, State};

use crate::memory::chat_import::{
    confirm_claude_import, import_from_chatgpt_folder, preview_claude_import, ClaudeImportPreview,
    ImportResult,
};
use crate::memory::llm_context_import::run_llm_context_import_now;
use crate::memory::{
    append_message, cleanup_legacy_memory, create_conversation, create_conversation_with_mode,
    delete_conversation, delete_user_memory_key, get_conversation, get_data_status, get_messages,
    get_user_memory, list_conversations, open_app_data_folder, search_conversations,
    set_conversation_chat_mode, set_conversation_title, set_user_memory, AppendMessageMeta,
};
use crate::recording::dictation_index;
use crate::state::AppState;
use crate::sync::{get_sync_status, SyncRuntime};

use super::map_err;

#[command(rename_all = "camelCase")]
pub async fn memory_create_conversation(
    state: State<'_, AppState>,
    chat_mode: Option<String>,
) -> Result<String, String> {
    if let Some(mode) = chat_mode.as_deref() {
        create_conversation_with_mode(&state, Some(mode))
            .await
            .map_err(map_err)
    } else {
        create_conversation(&state).await.map_err(map_err)
    }
}

#[command(rename_all = "camelCase")]
pub async fn memory_set_conversation_chat_mode(
    state: State<'_, AppState>,
    conversation_id: String,
    chat_mode: String,
) -> Result<(), String> {
    set_conversation_chat_mode(&state, &conversation_id, &chat_mode)
        .await
        .map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_get_conversation(
    state: State<'_, AppState>,
    id: String,
) -> Result<Value, String> {
    let conv = get_conversation(&state, &id).await.map_err(map_err)?;
    serde_json::to_value(conv).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_list_conversations(state: State<'_, AppState>) -> Result<Value, String> {
    let list = list_conversations(&state).await.map_err(map_err)?;
    serde_json::to_value(list).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_delete_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    delete_conversation(&state, &conversation_id)
        .await
        .map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_get_messages(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<Value, String> {
    let msgs = get_messages(&state, &conversation_id)
        .await
        .map_err(map_err)?;
    serde_json::to_value(msgs).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_append_message(
    state: State<'_, AppState>,
    conversation_id: String,
    role: String,
    content: String,
    meta: Option<AppendMessageMeta>,
) -> Result<(), String> {
    append_message(&state, &conversation_id, &role, &content, meta)
        .await
        .map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_get_user_memory(state: State<'_, AppState>) -> Result<Value, String> {
    let mem = get_user_memory(&state).await.map_err(map_err)?;
    serde_json::to_value(mem).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_set_user_memory(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<(), String> {
    set_user_memory(&state, &key, &value).await.map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_delete_user_memory_key(
    state: State<'_, AppState>,
    key: String,
) -> Result<(), String> {
    delete_user_memory_key(&state, &key).await.map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_search_conversations(
    state: State<'_, AppState>,
    query: String,
    compose_first_only: Option<bool>,
) -> Result<Value, String> {
    let only = compose_first_only.unwrap_or(true);
    let results = search_conversations(&state, &query, only)
        .await
        .map_err(map_err)?;
    serde_json::to_value(results).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_import_from_chat_gpt_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    import_from_chatgpt_folder(&app, &state).await
}

#[command(rename_all = "camelCase")]
pub async fn memory_preview_claude_import(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ClaudeImportPreview, String> {
    preview_claude_import(&app, &state).await
}

#[command(rename_all = "camelCase")]
pub async fn memory_confirm_claude_import(
    state: State<'_, AppState>,
    folder_path: String,
    claude_ids: Option<Vec<String>>,
) -> Result<ImportResult, String> {
    confirm_claude_import(&state, folder_path, claude_ids).await
}

#[command(rename_all = "camelCase")]
pub async fn memory_import_llm_context(
    state: State<'_, AppState>,
    export_text: String,
) -> Result<Value, String> {
    match run_llm_context_import_now(&state, &export_text).await {
        Ok(Ok(result)) => Ok(serde_json::json!({ "ok": true, "result": result })),
        Ok(Err(error)) => Ok(serde_json::json!({ "ok": false, "error": error })),
        Err(e) => Err(map_err(e)),
    }
}

#[command(rename_all = "camelCase")]
pub async fn memory_open_app_data_folder() -> Result<(), String> {
    open_app_data_folder().await.map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_get_data_status(
    state: State<'_, AppState>,
    sync_runtime: State<'_, std::sync::Arc<SyncRuntime>>,
) -> Result<Value, String> {
    let mut status = get_data_status(&state).await.map_err(map_err)?;
    status.sync = serde_json::to_value(get_sync_status(&sync_runtime).await).map_err(map_err)?;
    serde_json::to_value(status).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_cleanup_legacy_memory() -> Result<Value, String> {
    let removed = cleanup_legacy_memory().await.map_err(map_err)?;
    Ok(serde_json::json!({ "removed": removed }))
}

#[command(rename_all = "camelCase")]
pub async fn memory_set_conversation_title(
    state: State<'_, AppState>,
    conversation_id: String,
    title: String,
) -> Result<(), String> {
    set_conversation_title(&state, &conversation_id, &title)
        .await
        .map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_mark_voice_dictation_session(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<String, String> {
    crate::memory::title::finalize_voice_dictation_session(app, &state, &conversation_id)
        .await
        .map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_link_dictation_recording(
    conversation_id: String,
    path: String,
) -> Result<(), String> {
    dictation_index::link(&conversation_id, std::path::Path::new(&path))
}

#[command(rename_all = "camelCase")]
pub async fn memory_get_conversation_recordings(conversation_id: String) -> Result<Value, String> {
    let recordings = dictation_index::list_links(&conversation_id);
    serde_json::to_value(serde_json::json!({ "recordings": recordings })).map_err(map_err)
}
