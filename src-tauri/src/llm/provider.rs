//! The text-model provider picked in Settings > Model, from
//! `resources/contracts/chatProviders.json`.

use std::sync::OnceLock;

use serde::Deserialize;
use serde_json::{json, Value};

const CONTRACT_JSON: &str = include_str!("../../../resources/contracts/chatProviders.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    OpenAi,
    Claude,
    Local,
}

impl ProviderKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ProviderKind::OpenAi => "openai",
            ProviderKind::Claude => "claude",
            ProviderKind::Local => "local",
        }
    }

    fn from_id(id: &str) -> Option<ProviderKind> {
        match id.trim() {
            "openai" => Some(ProviderKind::OpenAi),
            "claude" => Some(ProviderKind::Claude),
            "local" => Some(ProviderKind::Local),
            _ => None,
        }
    }

    pub fn parse(raw: Option<&str>) -> ProviderKind {
        raw.and_then(ProviderKind::from_id)
            .or_else(|| ProviderKind::from_id(&contract().default))
            .unwrap_or(ProviderKind::OpenAi)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractProvider {
    id: String,
    chat_model: String,
    small_model: String,
    #[serde(default)]
    default_base_url: Option<String>,
}

#[derive(Deserialize)]
struct Contract {
    default: String,
    providers: Vec<ContractProvider>,
}

fn contract() -> &'static Contract {
    static CONTRACT: OnceLock<Contract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(CONTRACT_JSON).expect("resources/contracts/chatProviders.json must parse")
    })
}

fn contract_provider(kind: ProviderKind) -> &'static ContractProvider {
    contract()
        .providers
        .iter()
        .find(|p| p.id == kind.as_str())
        .expect("chatProviders.json lists every provider")
}

/// Default chat and small models for a provider.
pub fn contract_models(kind: ProviderKind) -> (&'static str, &'static str) {
    let provider = contract_provider(kind);
    (&provider.chat_model, &provider.small_model)
}

fn default_local_base_url() -> &'static str {
    contract_provider(ProviderKind::Local)
        .default_base_url
        .as_deref()
        .unwrap_or("")
}

/// The `model` settings object, with defaults filled in.
pub fn parse_model_settings(raw: Option<&Value>) -> Value {
    let text = |key: &str, fallback: &str| {
        raw.and_then(|v| v.get(key))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(fallback)
            .to_string()
    };
    json!({
        "provider": ProviderKind::parse(raw.and_then(|v| v.get("provider")).and_then(|v| v.as_str())).as_str(),
        "localBaseUrl": text("localBaseUrl", default_local_base_url()),
        "localModel": text("localModel", contract_models(ProviderKind::Local).0),
    })
}

/// Which model a call needs. OpenAI keeps its per-purpose env overrides.
#[derive(Debug, Clone, Copy)]
pub enum ModelTier {
    Chat,
    Small,
    Cleanup,
}

#[derive(Debug, Clone)]
pub struct Provider {
    pub kind: ProviderKind,
    pub(super) api_key: String,
    pub(super) base_url: String,
    local_model: String,
}

impl Provider {
    /// The provider from settings, or why it can't run yet.
    pub async fn active() -> Result<Provider, String> {
        let settings = crate::settings::read_settings_snapshot().await;
        let kind = ProviderKind::parse(
            settings.pointer("/model/provider").and_then(|v| v.as_str()),
        );
        let key = match kind {
            ProviderKind::OpenAi => crate::credentials::resolve_openai_api_key().await,
            ProviderKind::Claude => crate::credentials::resolve_anthropic_api_key().await,
            ProviderKind::Local => String::new(),
        };
        Provider::from_settings(&settings, kind, key.trim())
    }

    pub fn from_settings(settings: &Value, kind: ProviderKind, api_key: &str) -> Result<Provider, String> {
        let model = parse_model_settings(settings.get("model"));
        let base_url = match kind {
            ProviderKind::OpenAi => super::OPENAI_BASE_URL.to_string(),
            ProviderKind::Claude => super::ANTHROPIC_BASE_URL.to_string(),
            ProviderKind::Local => with_trailing_slash(model["localBaseUrl"].as_str().unwrap_or("")),
        };
        match kind {
            ProviderKind::OpenAi if api_key.is_empty() => return Err("OpenAI API key required.".into()),
            ProviderKind::Claude if api_key.is_empty() => return Err("Anthropic API key required.".into()),
            _ => {}
        }
        Ok(Provider {
            kind,
            api_key: api_key.to_string(),
            base_url,
            local_model: model["localModel"].as_str().unwrap_or("").to_string(),
        })
    }

    pub fn model(&self, tier: ModelTier) -> String {
        match (self.kind, tier) {
            (ProviderKind::OpenAi, ModelTier::Chat) => crate::openai::openai_chat_model(),
            (ProviderKind::OpenAi, ModelTier::Small) => crate::openai::openai_title_model(),
            (ProviderKind::OpenAi, ModelTier::Cleanup) => crate::openai::openai_transcript_cleanup_model(),
            (ProviderKind::Local, _) => self.local_model.clone(),
            (ProviderKind::Claude, ModelTier::Chat) => contract_models(ProviderKind::Claude).0.to_string(),
            (ProviderKind::Claude, _) => contract_models(ProviderKind::Claude).1.to_string(),
        }
    }
}

#[cfg(test)]
impl Provider {
    pub(super) fn for_test(kind: ProviderKind, base_url: &str, local_model: &str) -> Provider {
        Provider {
            kind,
            api_key: "sk-test".into(),
            base_url: base_url.into(),
            local_model: local_model.into(),
        }
    }
}

fn with_trailing_slash(url: &str) -> String {
    let url = url.trim();
    if url.ends_with('/') {
        url.to_string()
    } else {
        format!("{url}/")
    }
}

pub struct ChatProviderStatus {
    pub provider: String,
    pub ready: bool,
}

pub async fn chat_provider_status() -> ChatProviderStatus {
    let settings = crate::settings::read_settings_snapshot().await;
    let kind = ProviderKind::parse(settings.pointer("/model/provider").and_then(|v| v.as_str()));
    ChatProviderStatus {
        provider: kind.as_str().to_string(),
        ready: Provider::active().await.is_ok(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_contract_provider_has_a_kind() {
        for provider in &contract().providers {
            assert!(ProviderKind::from_id(&provider.id).is_some(), "unknown provider {}", provider.id);
        }
        assert!(ProviderKind::from_id(&contract().default).is_some());
    }

    #[test]
    fn model_settings_default_from_the_contract() {
        let parsed = parse_model_settings(None);
        assert_eq!(parsed["provider"], "openai");
        assert_eq!(parsed["localBaseUrl"], "http://localhost:11434/v1");
        assert_eq!(parsed["localModel"], "qwen3:4b");
        let parsed = parse_model_settings(Some(&json!({ "provider": "gemini", "localModel": "  " })));
        assert_eq!(parsed["provider"], "openai");
        assert_eq!(parsed["localModel"], "qwen3:4b");
    }

    #[test]
    fn providers_need_their_key_except_local() {
        let settings = |provider: &str| json!({ "model": { "provider": provider, "localModel": "llama4" } });
        assert_eq!(
            Provider::from_settings(&settings("openai"), ProviderKind::OpenAi, "").unwrap_err(),
            "OpenAI API key required."
        );
        assert_eq!(
            Provider::from_settings(&settings("claude"), ProviderKind::Claude, "").unwrap_err(),
            "Anthropic API key required."
        );
        let local = Provider::from_settings(&settings("local"), ProviderKind::Local, "").unwrap();
        assert_eq!(local.base_url, "http://localhost:11434/v1/");
        assert_eq!(local.model(ModelTier::Chat), "llama4");
        assert_eq!(local.model(ModelTier::Small), "llama4");
        let claude = Provider::from_settings(&settings("claude"), ProviderKind::Claude, "sk-ant").unwrap();
        assert_eq!(claude.model(ModelTier::Chat), "claude-opus-5-5");
        assert_eq!(claude.model(ModelTier::Cleanup), "claude-haiku-5-5");
    }

    #[test]
    fn openai_defaults_match_the_contract() {
        let (chat, small) = contract_models(ProviderKind::OpenAi);
        if std::env::var("OPENAI_CHAT_MODEL").is_err() {
            assert_eq!(crate::openai::openai_chat_model(), chat);
        }
        if std::env::var("OPENAI_TITLE_MODEL").is_err() {
            assert_eq!(crate::openai::openai_title_model(), small);
        }
    }
}
