//! Settings read/write and system prompt preview.

use serde_json::Value;
use tauri::{command, AppHandle, State};

use crate::chat::ChatController;
use crate::recording::global::{
    apply_global_fn_hotkey_setting, global_fn_hotkey_enabled_from_recording,
};
use crate::settings::{get_settings, set_settings};
use crate::state::AppState;

use super::map_err;

#[command(rename_all = "camelCase")]
pub async fn settings_get(state: State<'_, AppState>) -> Result<Value, String> {
    Ok(get_settings(&state.write_chains).await)
}

#[command(rename_all = "camelCase")]
pub async fn settings_set(
    app: AppHandle,
    state: State<'_, AppState>,
    runtime: State<'_, std::sync::Arc<crate::recording::global::GlobalRecordingRuntime>>,
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
    chat_mode: Option<String>,
) -> Result<crate::chat::system_prompt::SystemPromptPreview, String> {
    chat.get_system_prompt_preview(&platform, chat_mode.as_deref())
        .await
}
