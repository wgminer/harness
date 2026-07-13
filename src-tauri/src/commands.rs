//! Tauri command handlers wiring renderer IPC to backend modules.

use serde_json::Value;
use tauri::{command, AppHandle, Emitter, State, Window};

use crate::chat::ChatController;
use crate::credentials::{
    get_credential_status, get_secrets_for_settings, set_credential, CredentialKey,
};
use crate::customization::{get_layout_options, set_layout};
use crate::dictation_recording_index;
use crate::env_util::{is_harness_dev, is_harness_e2e};
use crate::file_tools::get_allowed_roots;
use crate::global_recording::{
    apply_global_fn_hotkey_setting, global_fn_hotkey_enabled_from_recording,
};
use crate::import::{import_from_claude_folder, import_from_chatgpt_folder};
use crate::memory::{
    append_message, cleanup_legacy_memory, create_conversation, delete_conversation,
    delete_user_memory_key, get_conversation, get_data_status, get_messages, get_user_memory,
    list_conversations, open_app_data_folder,
    search_conversations, set_conversation_title, set_user_memory, AppState, AppendMessageMeta,
};
use crate::memory_compile::{get_memory_compile_status, run_memory_compile_now};
use crate::memory_import::run_llm_context_import_now;
use crate::notes::{create_note, delete_note, list_notes, propose_note_edit, propose_note_spell_check, read_note, save_note, show_note_in_folder};
use crate::plans::{
    add_conversation_to_plan, create_plan, delete_plan, list_plans, remove_conversation_from_plan,
    update_plan, PlanUpdates,
};
use crate::settings::{get_settings, set_settings};
use crate::sticky_notes::{
    open_sticky_window, pop_in_sticky, set_sticky_pinned, set_sticky_title, StickyWindowEntry,
};
use crate::sync::{get_sync_status, SyncRuntime};
use crate::tasks::{clear_completed_tasks, create_task, delete_task, list_tasks, update_task};
use crate::ui_session::{get_ui_session, set_ui_session};

const LARGE_WIDTH: f64 = 1024.0;
const LARGE_HEIGHT: f64 = 768.0;
const SMALL_WIDTH: f64 = 400.0;
const SMALL_HEIGHT: f64 = 480.0;
const WINDOW_SMALL_PRESET_MAX_WIDTH_PX: u32 = 400;

fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[command(rename_all = "camelCase")]
pub fn app_get_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[command(rename_all = "camelCase")]
pub fn env_is_harness_dev() -> bool {
    is_harness_dev()
}

#[command(rename_all = "camelCase")]
pub fn env_is_harness_e2e() -> bool {
    is_harness_e2e()
}

#[command(rename_all = "camelCase")]
pub fn window_get_size(window: Window) -> String {
    let size = window.outer_size().unwrap_or_default();
    if size.width <= WINDOW_SMALL_PRESET_MAX_WIDTH_PX {
        "small".into()
    } else {
        "large".into()
    }
}

#[command(rename_all = "camelCase")]
pub fn window_toggle_size(window: Window) -> Result<String, String> {
    let size = window.outer_size().map_err(map_err)?;
    if size.width <= WINDOW_SMALL_PRESET_MAX_WIDTH_PX {
        window
            .set_size(tauri::LogicalSize::new(LARGE_WIDTH, LARGE_HEIGHT))
            .map_err(map_err)?;
        Ok("large".into())
    } else {
        window
            .set_size(tauri::LogicalSize::new(SMALL_WIDTH, SMALL_HEIGHT))
            .map_err(map_err)?;
        Ok("small".into())
    }
}

#[command(rename_all = "camelCase")]
pub async fn settings_get(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(get_settings(&state.write_chains).await)
}

#[command(rename_all = "camelCase")]
pub async fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    runtime: State<'_, std::sync::Arc<crate::global_recording::GlobalRecordingRuntime>>,
    partial: Value,
) -> Result<(), String> {
    set_settings(&state.write_chains, &partial)
        .await
        .map_err(map_err)?;
    if let Some(recording) = partial.get("recording") {
        if recording.get("globalFnHotkey").is_some() {
            apply_global_fn_hotkey_setting(
                app,
                runtime.inner().clone(),
                global_fn_hotkey_enabled_from_recording(recording),
            )
            .await;
        }
    }
    Ok(())
}

#[command(rename_all = "camelCase")]
pub async fn settings_get_system_prompt_preview(
    chat: State<'_, ChatController>,
    platform: String,
) -> Result<crate::system_prompt::SystemPromptPreview, String> {
    chat.get_system_prompt_preview(&platform).await
}

#[command(rename_all = "camelCase")]
pub async fn credentials_get_status() -> Result<Value, String> {
    let status = get_credential_status().await;
    serde_json::to_value(status).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn credentials_get_secrets_for_settings() -> Result<Value, String> {
    let secrets = get_secrets_for_settings().await;
    serde_json::to_value(secrets).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub fn credentials_set_open_ai_api_key(value: String) -> Result<(), String> {
    set_credential(CredentialKey::OpenAiApiKey, &value).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub fn credentials_set_tavily_api_key(value: String) -> Result<(), String> {
    set_credential(CredentialKey::TavilyApiKey, &value).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub fn credentials_set_r2_secret_access_key(value: String) -> Result<(), String> {
    set_credential(CredentialKey::R2SecretAccessKey, &value).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_create_conversation(state: State<'_, AppState>) -> Result<String, String> {
    create_conversation(&state).await.map_err(map_err)
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
    let msgs = get_messages(&state, &conversation_id).await.map_err(map_err)?;
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
pub async fn memory_import_from_claude_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Value, String> {
    import_from_claude_folder(&app, &state).await
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
pub async fn memory_run_compile_now(state: State<'_, AppState>) -> Result<Value, String> {
    match run_memory_compile_now(&state).await {
        Ok(Ok(result)) => Ok(serde_json::json!({ "ok": true, "result": result })),
        Ok(Err(error)) => Ok(serde_json::json!({ "ok": false, "error": error })),
        Err(e) => Err(map_err(e)),
    }
}

#[command(rename_all = "camelCase")]
pub async fn memory_get_compile_status(state: State<'_, AppState>) -> Result<Value, String> {
    let status = get_memory_compile_status(&state).await;
    serde_json::to_value(status).map_err(map_err)
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
    crate::conversation_title::finalize_voice_dictation_session(app, &state, &conversation_id)
        .await
        .map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn memory_link_dictation_recording(
    conversation_id: String,
    path: String,
) -> Result<(), String> {
    dictation_recording_index::link(&conversation_id, std::path::Path::new(&path))
}

#[command(rename_all = "camelCase")]
pub async fn memory_get_conversation_recordings(
    conversation_id: String,
) -> Result<Value, String> {
    let recordings = dictation_recording_index::list_links(&conversation_id);
    serde_json::to_value(serde_json::json!({ "recordings": recordings })).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn plans_list(state: State<'_, AppState>) -> Result<Value, String> {
    let plans = list_plans(&state).await.map_err(map_err)?;
    serde_json::to_value(plans).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn plans_create(
    state: State<'_, AppState>,
    title: String,
    description: String,
) -> Result<Value, String> {
    let plan = create_plan(&state, &title, &description)
        .await
        .map_err(map_err)?;
    serde_json::to_value(plan).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn plans_update(
    state: State<'_, AppState>,
    plan_id: String,
    updates: PlanUpdates,
) -> Result<Value, String> {
    let plan = update_plan(&state, &plan_id, updates)
        .await
        .map_err(map_err)?;
    serde_json::to_value(plan).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn plans_delete(state: State<'_, AppState>, plan_id: String) -> Result<(), String> {
    delete_plan(&state, &plan_id).await.map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn plans_add_conversation(
    state: State<'_, AppState>,
    plan_id: String,
    conversation_id: String,
) -> Result<Value, String> {
    let plan = add_conversation_to_plan(&state, &plan_id, &conversation_id)
        .await
        .map_err(map_err)?;
    serde_json::to_value(plan).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn plans_remove_conversation(
    state: State<'_, AppState>,
    plan_id: String,
    conversation_id: String,
) -> Result<Value, String> {
    let plan = remove_conversation_from_plan(&state, &plan_id, &conversation_id)
        .await
        .map_err(map_err)?;
    serde_json::to_value(plan).map_err(map_err)
}

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

#[command(rename_all = "camelCase")]
pub async fn chat_send(
    chat: State<'_, ChatController>,
    conversation_id: String,
    user_content: String,
) -> Result<(), String> {
    chat.send(&conversation_id, &user_content).await
}

#[command(rename_all = "camelCase")]
pub async fn chat_polish_last_user(
    chat: State<'_, ChatController>,
    conversation_id: String,
) -> Result<(), String> {
    chat.polish_last_user(&conversation_id).await
}

#[command(rename_all = "camelCase")]
pub async fn chat_generate_reply(
    chat: State<'_, ChatController>,
    conversation_id: String,
) -> Result<(), String> {
    chat.generate_reply(&conversation_id).await
}

#[command(rename_all = "camelCase")]
pub async fn chat_get_context_preview(
    chat: State<'_, ChatController>,
    conversation_id: Option<String>,
) -> Result<Value, String> {
    let preview = chat
        .get_context_preview(conversation_id.as_deref())
        .await?;
    serde_json::to_value(preview).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn chat_stop(chat: State<'_, ChatController>) -> Result<(), String> {
    chat.stop().await;
    Ok(())
}

#[command(rename_all = "camelCase")]
pub async fn chat_resolve_gated_tool(
    chat: State<'_, ChatController>,
    pending_id: String,
    action: String,
) -> Result<(), String> {
    chat.resolve_gated_tool(&pending_id, &action).await;
    Ok(())
}

#[command(rename_all = "camelCase")]
pub fn ui_session_get() -> Value {
    serde_json::to_value(get_ui_session()).unwrap_or_default()
}

#[command(rename_all = "camelCase")]
pub fn ui_session_set(partial: Value) -> Value {
    serde_json::to_value(set_ui_session(&partial)).unwrap_or_default()
}

#[command(rename_all = "camelCase")]
pub fn customization_get_layout_options() -> Value {
    serde_json::to_value(get_layout_options()).unwrap_or_default()
}

#[command(rename_all = "camelCase")]
pub fn customization_set_layout(
    app: AppHandle,
    options: Value,
) -> Result<(), String> {
    let _layout = set_layout(&options);
    let _ = app.emit("customization-updated", serde_json::json!({ "type": "layout" }));
    Ok(())
}

#[command(rename_all = "camelCase")]
pub fn file_tools_get_allowed_roots() -> Vec<String> {
    get_allowed_roots()
        .into_iter()
        .map(|p| p.display().to_string())
        .collect()
}

#[command(rename_all = "camelCase")]
pub async fn notes_list(state: State<'_, AppState>) -> Result<Value, String> {
    let notes = list_notes(&state).await.map_err(map_err)?;
    serde_json::to_value(notes).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_create(
    state: State<'_, AppState>,
    title: Option<String>,
    content: Option<String>,
) -> Result<Value, String> {
    let note = create_note(
        &state,
        title.as_deref(),
        content.as_deref().unwrap_or(""),
    )
        .await
        .map_err(map_err)?;
    serde_json::to_value(note).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_read(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let note = read_note(&state, &id).await.map_err(map_err)?;
    serde_json::to_value(note).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_save(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<Value, String> {
    let note = save_note(&state, &id, &content).await.map_err(map_err)?;
    serde_json::to_value(note).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_delete(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let list = delete_note(&state, &id).await.map_err(map_err)?;
    serde_json::to_value(list).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_show_in_folder(id: String) -> Result<(), String> {
    show_note_in_folder(&id).await.map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_propose_edit(input: Value) -> Result<Value, String> {
    let proposal = propose_note_edit(&input).await.map_err(map_err)?;
    serde_json::to_value(proposal).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_spell_check(input: Value) -> Result<Value, String> {
    let proposal = propose_note_spell_check(&input).await.map_err(map_err)?;
    serde_json::to_value(proposal).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_open_sticky(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
) -> Result<StickyWindowEntry, String> {
    open_sticky_window(&app, &state, &note_id, None).await
}

#[command(rename_all = "camelCase")]
pub async fn notes_set_sticky_pinned(
    app: AppHandle,
    note_id: String,
    pinned: bool,
) -> Result<(), String> {
    set_sticky_pinned(&app, &note_id, pinned)
}

#[command(rename_all = "camelCase")]
pub async fn notes_set_sticky_title(
    app: AppHandle,
    note_id: String,
    title: String,
) -> Result<(), String> {
    set_sticky_title(&app, &note_id, &title)
}

#[command(rename_all = "camelCase")]
pub async fn notes_pop_in_sticky(app: AppHandle, note_id: String) -> Result<(), String> {
    pop_in_sticky(&app, &note_id)
}
