//! Voice PE external button: connection settings and status.

use std::sync::Arc;

use serde_json::Value;
use tauri::{command, AppHandle, State};

use crate::recording::external_button::ExternalButton;

use super::map_err;

#[command(rename_all = "camelCase")]
pub fn external_button_get_status(button: State<'_, Arc<ExternalButton>>) -> Result<Value, String> {
    serde_json::to_value(button.status()).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub fn external_button_configure(
    app: AppHandle,
    button: State<'_, Arc<ExternalButton>>,
    enabled: bool,
    host: String,
    key: Option<String>,
    use_mic: Option<bool>,
) -> Result<Value, String> {
    let use_mic = use_mic.unwrap_or_else(|| button.status().use_mic);
    let status = button.configure(&app, enabled, &host, key.as_deref(), use_mic)?;
    serde_json::to_value(status).map_err(map_err)
}
