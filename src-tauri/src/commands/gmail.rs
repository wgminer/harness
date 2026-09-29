//! Gmail connection: OAuth client config, consent flow, and status.

use serde_json::Value;
use tauri::{command, AppHandle};
use tauri_plugin_opener::OpenerExt;

use crate::gmail;

use super::map_err;

#[command(rename_all = "camelCase")]
pub fn gmail_get_status() -> Result<Value, String> {
    serde_json::to_value(gmail::status()).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub fn gmail_set_client(client_id: String, client_secret: String) -> Result<Value, String> {
    gmail::set_client(&client_id, &client_secret)?;
    serde_json::to_value(gmail::status()).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn gmail_connect(app: AppHandle) -> Result<Value, String> {
    let status = gmail::connect(|url| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string())
    })
    .await?;
    serde_json::to_value(status).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn gmail_disconnect() -> Result<Value, String> {
    let status = gmail::disconnect().await?;
    serde_json::to_value(status).map_err(map_err)
}
