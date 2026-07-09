use std::collections::HashMap;
use std::fs;
use std::sync::Once;

use keyring::Entry;
use serde::{Deserialize, Serialize};

use crate::env_util::{is_harness_dev, is_harness_e2e};
use crate::paths::get_credentials_path;

pub const SERVICE: &str = "com.harness.credentials";

pub const KEY_OPENAI_API_KEY: &str = "openai.apiKey";
pub const KEY_TAVILY_API_KEY: &str = "search.tavilyApiKey";
pub const KEY_R2_SECRET_ACCESS_KEY: &str = "r2.secretAccessKey";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CredentialKey {
    OpenAiApiKey,
    TavilyApiKey,
    R2SecretAccessKey,
}

impl CredentialKey {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OpenAiApiKey => KEY_OPENAI_API_KEY,
            Self::TavilyApiKey => KEY_TAVILY_API_KEY,
            Self::R2SecretAccessKey => KEY_R2_SECRET_ACCESS_KEY,
        }
    }

    pub fn from_str(key: &str) -> Option<Self> {
        match key {
            KEY_OPENAI_API_KEY => Some(Self::OpenAiApiKey),
            KEY_TAVILY_API_KEY => Some(Self::TavilyApiKey),
            KEY_R2_SECRET_ACCESS_KEY => Some(Self::R2SecretAccessKey),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    #[serde(rename = "hasOpenAIApiKey")]
    pub has_open_ai_api_key: bool,
    pub has_tavily_api_key: bool,
    pub has_r2_secret_access_key: bool,
    pub encryption_available: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSecrets {
    #[serde(rename = "openaiApiKey")]
    pub openai_api_key: String,
    #[serde(rename = "tavilyApiKey")]
    pub tavily_api_key: String,
    #[serde(rename = "r2SecretAccessKey")]
    pub r2_secret_access_key: String,
}

fn entry_for(key: CredentialKey) -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE, key.as_str())
}

fn uses_file_store() -> bool {
    is_harness_dev() && !is_harness_e2e()
}

fn platform_failure(err: impl std::error::Error + Send + Sync + 'static) -> keyring::Error {
    keyring::Error::PlatformFailure(Box::new(err))
}

fn read_file_store() -> HashMap<String, String> {
    let path = get_credentials_path();
    if !path.exists() {
        return HashMap::new();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_file_store(store: &HashMap<String, String>) -> Result<(), keyring::Error> {
    let path = get_credentials_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(platform_failure)?;
    }
    let json = serde_json::to_string_pretty(store).map_err(platform_failure)?;
    fs::write(&path, json).map_err(platform_failure)
}

fn file_store_has_secrets() -> bool {
    read_file_store()
        .values()
        .any(|value| !value.trim().is_empty())
}

fn migrate_keyring_to_file_once() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        if file_store_has_secrets() {
            return;
        }
        let mut store = HashMap::new();
        for key in [
            CredentialKey::OpenAiApiKey,
            CredentialKey::TavilyApiKey,
            CredentialKey::R2SecretAccessKey,
        ] {
            let Ok(entry) = entry_for(key) else {
                continue;
            };
            let Ok(value) = entry.get_password() else {
                continue;
            };
            if value.trim().is_empty() {
                continue;
            }
            store.insert(key.as_str().to_string(), value);
        }
        if !store.is_empty() {
            let _ = write_file_store(&store);
        }
    });
}

fn get_credential_from_file(key: CredentialKey) -> Option<String> {
    migrate_keyring_to_file_once();
    let value = read_file_store().get(key.as_str())?.clone();
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn set_credential_in_file(key: CredentialKey, value: &str) -> Result<(), keyring::Error> {
    migrate_keyring_to_file_once();
    let mut store = read_file_store();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        store.remove(key.as_str());
    } else {
        store.insert(key.as_str().to_string(), trimmed.to_string());
    }
    write_file_store(&store)
}

fn get_credential_from_keyring(key: CredentialKey) -> Option<String> {
    let entry = entry_for(key).ok()?;
    let value = entry.get_password().ok()?;
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn set_credential_in_keyring(key: CredentialKey, value: &str) -> Result<(), keyring::Error> {
    let entry = entry_for(key)?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        let _ = entry.set_password("");
        return Ok(());
    }
    entry.set_password(trimmed)
}

pub fn encryption_available() -> bool {
    if uses_file_store() {
        return true;
    }
    const PROBE_KEY: &str = "__harness_keyring_probe__";
    match Entry::new(SERVICE, PROBE_KEY) {
        Ok(entry) => {
            if entry.set_password("1").is_err() {
                return false;
            }
            let ok = entry.get_password().is_ok();
            let _ = entry.set_password("");
            ok
        }
        Err(_) => false,
    }
}

pub fn get_credential(key: CredentialKey) -> Option<String> {
    if uses_file_store() {
        get_credential_from_file(key)
    } else {
        get_credential_from_keyring(key)
    }
}

pub fn get_credential_by_name(key: &str) -> Option<String> {
    CredentialKey::from_str(key).and_then(get_credential)
}

pub fn set_credential(key: CredentialKey, value: &str) -> Result<(), keyring::Error> {
    if uses_file_store() {
        set_credential_in_file(key, value)
    } else {
        set_credential_in_keyring(key, value)
    }
}

pub fn set_credential_by_name(key: &str, value: &str) -> Result<(), keyring::Error> {
    let Some(cred_key) = CredentialKey::from_str(key) else {
        return Ok(());
    };
    set_credential(cred_key, value)
}

pub fn delete_credential(key: CredentialKey) -> Result<(), keyring::Error> {
    set_credential(key, "")
}

pub async fn get_secrets_for_settings() -> SettingsSecrets {
    SettingsSecrets {
        openai_api_key: get_credential(CredentialKey::OpenAiApiKey).unwrap_or_default(),
        tavily_api_key: get_credential(CredentialKey::TavilyApiKey).unwrap_or_default(),
        r2_secret_access_key: get_credential(CredentialKey::R2SecretAccessKey).unwrap_or_default(),
    }
}

pub async fn get_credential_status() -> CredentialStatus {
    let secrets = get_secrets_for_settings().await;
    CredentialStatus {
        has_open_ai_api_key: !secrets.openai_api_key.trim().is_empty(),
        has_tavily_api_key: !secrets.tavily_api_key.trim().is_empty(),
        has_r2_secret_access_key: !secrets.r2_secret_access_key.trim().is_empty(),
        encryption_available: encryption_available(),
    }
}

pub async fn migrate_secrets_from_settings_raw(raw: &mut serde_json::Value) -> bool {
    let mut changed = false;

    if let Some(openai_key) = raw
        .get("openai")
        .and_then(|v| v.get("apiKey"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if get_credential(CredentialKey::OpenAiApiKey).is_none() {
            let _ = set_credential(CredentialKey::OpenAiApiKey, openai_key);
        }
        if let Some(openai) = raw.get_mut("openai").and_then(|v| v.as_object_mut()) {
            openai.remove("apiKey");
            changed = true;
        }
    }

    if let Some(tavily_key) = raw
        .get("search")
        .and_then(|v| v.get("tavilyApiKey"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if get_credential(CredentialKey::TavilyApiKey).is_none() {
            let _ = set_credential(CredentialKey::TavilyApiKey, tavily_key);
        }
        if let Some(search) = raw.get_mut("search").and_then(|v| v.as_object_mut()) {
            search.remove("tavilyApiKey");
            changed = true;
        }
    }

    changed
}

pub async fn resolve_openai_api_key() -> String {
    get_credential(CredentialKey::OpenAiApiKey).unwrap_or_default()
}

pub async fn resolve_tavily_api_key() -> String {
    get_credential(CredentialKey::TavilyApiKey).unwrap_or_default()
}

pub async fn resolve_r2_secret_access_key() -> String {
    get_credential(CredentialKey::R2SecretAccessKey).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::SettingsSecrets;

    #[test]
    fn settings_secrets_use_frontend_field_names() {
        let secrets = SettingsSecrets {
            openai_api_key: "sk-test".into(),
            tavily_api_key: "tvly-test".into(),
            r2_secret_access_key: "r2-test".into(),
        };
        let json = serde_json::to_value(secrets).expect("serialize");
        assert_eq!(json.get("openaiApiKey").and_then(|v| v.as_str()), Some("sk-test"));
        assert_eq!(json.get("tavilyApiKey").and_then(|v| v.as_str()), Some("tvly-test"));
        assert_eq!(
            json.get("r2SecretAccessKey").and_then(|v| v.as_str()),
            Some("r2-test")
        );
    }
}
