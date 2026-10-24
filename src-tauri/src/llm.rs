//! Text-model calls (chat streaming, small JSON helpers) on top of the `genai` crate,
//! sent to the provider picked in Settings > Model. Images stay on the hand-written
//! client in `openai.rs`.

mod chat_stream;
mod json;
mod messages;
mod provider;
mod raw_frames;
#[cfg(test)]
mod test_server;

use std::time::Duration;

use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client, ModelIden, ServiceTarget, WebConfig};

use crate::openai::OpenAIError;

pub use chat_stream::ChatClient;
pub use json::{complete, generate_thread_title, Completion};
pub use provider::{
    chat_provider_status, contract_models, parse_model_settings, ModelTier, Provider, ProviderKind,
};

const OPENAI_BASE_URL: &str = "https://api.openai.com/v1/";
const ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com/v1/";

/// A genai client that sends every model to the provider's endpoint on one API:
/// OpenAI chat on the Responses API, its small calls on Chat Completions, Claude on
/// Messages, and local models on their OpenAI-compatible Chat Completions.
fn genai_client(provider: &Provider, streaming_chat: bool, timeout: Duration) -> Result<Client, OpenAIError> {
    let adapter = match provider.kind {
        ProviderKind::OpenAi if streaming_chat => AdapterKind::OpenAIResp,
        ProviderKind::OpenAi | ProviderKind::Local => AdapterKind::OpenAI,
        ProviderKind::Claude => AdapterKind::Anthropic,
    };
    // Ollama and LM Studio ignore the key, but genai wants one.
    let api_key = if provider.api_key.is_empty() {
        "local".to_string()
    } else {
        provider.api_key.clone()
    };
    let base_url = provider.base_url.clone();
    let target = ServiceTargetResolver::from_resolver_fn(
        move |target: ServiceTarget| -> Result<ServiceTarget, genai::resolver::Error> {
            Ok(ServiceTarget {
                endpoint: Endpoint::from_owned(base_url.clone()),
                auth: AuthData::from_single(api_key.clone()),
                model: ModelIden::new(adapter, target.model.model_name),
            })
        },
    );
    Client::builder()
        .with_web_config(WebConfig::default().with_timeout(timeout))
        .with_service_target_resolver(target)
        .build()
        .map_err(map_genai_error)
}

/// A streamed call that got a non-2xx response reports it wrapped in `WebStream`.
fn unwrap_stream_error(err: &genai::Error) -> &genai::Error {
    match err {
        genai::Error::WebStream { error, .. } => error.downcast_ref::<genai::Error>().unwrap_or(err),
        _ => err,
    }
}

fn error_status(err: &genai::Error) -> Option<u16> {
    unwrap_stream_error(err).status().map(|status| status.as_u16())
}

/// The provider's HTTP response body, when the call got one.
fn error_body(err: &genai::Error) -> Option<&str> {
    use genai::webc::Error as WebcError;
    match unwrap_stream_error(err) {
        genai::Error::WebModelCall {
            webc_error: WebcError::ResponseFailedStatus { body, .. },
            ..
        }
        | genai::Error::WebAdapterCall {
            webc_error: WebcError::ResponseFailedStatus { body, .. },
            ..
        }
        | genai::Error::HttpError { body, .. } => Some(body),
        _ => None,
    }
}

/// Errors read the same as before genai: the raw OpenAI error body, or the
/// message from a failed or errored stream.
fn map_genai_error(err: genai::Error) -> OpenAIError {
    if let Some(body) = error_body(&err) {
        return OpenAIError::Api(body.to_string());
    }
    match err {
        // genai reports `response.failed` this way, with the API's message.
        genai::Error::StreamParse { serde_error, .. } => OpenAIError::Api(serde_error.to_string()),
        genai::Error::ChatResponse { body, .. } => OpenAIError::Api(
            body.pointer("/response/error/message")
                .or_else(|| body.pointer("/error/message"))
                .or_else(|| body.get("message"))
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .unwrap_or_else(|| body.to_string()),
        ),
        other => OpenAIError::Api(other.to_string()),
    }
}
