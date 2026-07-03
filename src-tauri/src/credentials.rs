use keyring::Entry;
use serde::{Deserialize, Serialize};

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
    pub openai_api_key: String,
    pub tavily_api_key: String,
    pub r2_secret_access_key: String,
}

fn entry_for(key: CredentialKey) -> Result<Entry, keyring::Error> {
    Entry::new(SERVICE, key.as_str())
}

pub fn encryption_available() -> bool {
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
    let entry = entry_for(key).ok()?;
    let value = entry.get_password().ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(value)
    }
}

pub fn get_credential_by_name(key: &str) -> Option<String> {
    CredentialKey::from_str(key).and_then(get_credential)
}

pub fn set_credential(key: CredentialKey, value: &str) -> Result<(), keyring::Error> {
    let entry = entry_for(key)?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        let _ = entry.set_password("");
        return Ok(());
    }
    entry.set_password(trimmed)
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
