//! Text-model calls (chat streaming, small JSON helpers) on top of the `genai` crate.
//!
//! Only OpenAI is wired today; the provider switch lands on this seam. Images stay
//! on the hand-written client in `openai.rs`.

mod chat_stream;
mod json;
mod messages;
mod raw_frames;
#[cfg(test)]
mod test_server;

use std::time::Duration;

use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint, ServiceTargetResolver};
use genai::{Client, ModelIden, ServiceTarget, WebConfig};

use crate::openai::OpenAIError;

pub use chat_stream::OpenAIChatClient;
pub use json::{chat_completion_json, generate_thread_title_with_openai};

const OPENAI_BASE_URL: &str = "https://api.openai.com/v1/";

/// A genai client that sends every model to OpenAI on the given API
/// (`OpenAIResp` for the Responses API, `OpenAI` for Chat Completions).
fn openai_client(
    adapter: AdapterKind,
    api_key: &str,
    base_url: &str,
    timeout: Duration,
) -> Result<Client, OpenAIError> {
    let api_key = api_key.to_string();
    let base_url = base_url.to_string();
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
