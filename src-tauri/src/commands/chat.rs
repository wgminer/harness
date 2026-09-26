//! Chat turns, streaming control, and gated tools.

use serde_json::Value;
use tauri::{command, AppHandle, State};

use crate::chat::ChatController;
use crate::state::AppState;

use super::map_err;

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
pub async fn chat_ensure_dictation_reply_action(
    app: AppHandle,
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<String, String> {
    crate::recording::suggested_prompts::ensure_dictation_reply_action(
        &app,
        state.inner(),
        &conversation_id,
    )
    .await
}

#[command(rename_all = "camelCase")]
pub async fn chat_get_context_preview(
    chat: State<'_, ChatController>,
    conversation_id: Option<String>,
) -> Result<Value, String> {
    let preview = chat.get_context_preview(conversation_id.as_deref()).await?;
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
pub async fn chat_get_active_turn(chat: State<'_, ChatController>) -> Result<Value, String> {
    Ok(chat.get_active_turn().await)
}
