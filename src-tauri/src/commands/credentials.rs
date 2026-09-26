//! Credential status and secret storage.

use serde_json::Value;
use tauri::command;

use crate::credentials::{
    get_credential_status, get_secrets_for_settings, set_credential, CredentialKey,
};

use super::map_err;

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
