//! UI session and layout customization.

use serde_json::Value;
use tauri::{command, AppHandle, Emitter};

use crate::customization::{get_layout_options, set_layout};
use crate::ui_session::{get_ui_session, set_ui_session};

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
pub fn customization_set_layout(app: AppHandle, options: Value) -> Result<(), String> {
    let _layout = set_layout(&options);
    let _ = app.emit(
        "customization-updated",
        serde_json::json!({ "type": "layout" }),
    );
    Ok(())
}
