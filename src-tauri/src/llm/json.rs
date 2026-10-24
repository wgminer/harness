//! One-shot small-model calls (titles, JSON helpers) on Chat Completions via genai.

use std::time::Duration;

use genai::adapter::AdapterKind;
use genai::chat::{ChatMessage, ChatOptions, ChatRequest, ChatResponseFormat};
use serde_json::json;

use super::{map_genai_error, openai_client, OPENAI_BASE_URL};
use crate::openai::{openai_title_model, OpenAIError};

const TITLE_SYSTEM_PROMPT: &str = "You name chat threads for a sidebar. Reply with a short, descriptive title (a few words). \
No quotes or extra punctuation. \
If the previous title still fits the recent conversation, reply with exactly: UNCHANGED";

struct CompletionRequest<'a> {
    model: &'a str,
    system: &'a str,
    user: &'a str,
    max_completion_tokens: u32,
    reasoning_effort: &'a str,
    json: bool,
    timeout: Duration,
}

async fn complete(base_url: &str, api_key: &str, req: CompletionRequest<'_>) -> Result<String, OpenAIError> {
    let client = openai_client(AdapterKind::OpenAI, api_key, base_url, req.timeout)?;
    let request = ChatRequest::from_messages(vec![
        ChatMessage::system(req.system),
        ChatMessage::user(req.user),
    ]);
    // Exact Chat Completions fields, so genai doesn't remap them by model name.
    let mut options = ChatOptions::default().with_extra_body(json!({
        "max_completion_tokens": req.max_completion_tokens,
        "reasoning_effort": req.reasoning_effort
    }));
    if req.json {
        options = options.with_response_format(ChatResponseFormat::JsonMode);
    }
    let response = client
        .exec_chat(req.model, request, Some(&options))
        .await
        .map_err(map_genai_error)?;
    Ok(response.first_text().unwrap_or("").trim().to_string())
}

pub async fn generate_thread_title_with_openai(
    api_key: &str,
    previous_title: Option<&str>,
    context: &str,
) -> Result<Option<String>, OpenAIError> {
    let user_block = format!(
        "{}\n\nRecent conversation:\n{}",
        if let Some(title) = previous_title {
            format!("Previous title: {title}")
        } else {
            "Previous title: (none)".into()
        },
        context
    );
    let raw = complete(
        OPENAI_BASE_URL,
        api_key,
        CompletionRequest {
            model: &openai_title_model(),
            system: TITLE_SYSTEM_PROMPT,
            user: &user_block,
            max_completion_tokens: 512,
            reasoning_effort: "low",
            json: false,
            timeout: Duration::from_secs(10),
        },
    )
    .await?;
    Ok(title_from_reply(raw))
}

fn title_from_reply(raw: String) -> Option<String> {
    if raw.is_empty() || raw.eq_ignore_ascii_case("UNCHANGED") {
        return None;
    }
    Some(raw)
}

pub async fn chat_completion_json(
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    max_completion_tokens: u32,
    reasoning_effort: &str,
    timeout_secs: u64,
) -> Result<String, OpenAIError> {
    complete(
        OPENAI_BASE_URL,
        api_key,
        CompletionRequest {
            model,
            system,
            user,
            max_completion_tokens,
            reasoning_effort,
            json: true,
            timeout: Duration::from_secs(timeout_secs),
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::super::test_server::{serve, Reply};
    use super::*;

    #[tokio::test]
    async fn json_call_sends_chat_completions_fields() {
        let reply = json!({
            "id": "chatcmpl_1", "object": "chat.completion", "created": 0, "model": "gpt-6-luna",
            "choices": [{ "index": 0, "finish_reason": "stop",
                "message": { "role": "assistant", "content": "  {\"title\":\"Basil\"}\n" } }]
        });
        let (base_url, bodies) = serve(vec![Reply::json(200, reply)]).await;
        let text = complete(
            &base_url,
            "sk-test",
            CompletionRequest {
                model: "gpt-6-luna",
                system: "Reply in JSON.",
                user: "basil",
                max_completion_tokens: 300,
                reasoning_effort: "none",
                json: true,
                timeout: Duration::from_secs(5),
            },
        )
        .await
        .unwrap();
        assert_eq!(text, "{\"title\":\"Basil\"}");

        let body = bodies.lock().unwrap()[0].clone();
        assert_eq!(body["model"], "gpt-6-luna");
        assert_eq!(body["response_format"], json!({ "type": "json_object" }));
        assert_eq!(body["max_completion_tokens"], 300);
        assert_eq!(body["reasoning_effort"], "none");
        assert!(body.get("max_tokens").is_none());
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "Reply in JSON.");
        assert_eq!(body["messages"][1]["role"], "user");
    }

    #[tokio::test]
    async fn json_call_errors_keep_the_response_body() {
        let error = json!({ "error": { "message": "Rate limit reached." } });
        let (base_url, _) = serve(vec![Reply::json(429, error.clone())]).await;
        let result = complete(
            &base_url,
            "sk-test",
            CompletionRequest {
                model: "gpt-6-luna",
                system: "s",
                user: "u",
                max_completion_tokens: 10,
                reasoning_effort: "none",
                json: true,
                timeout: Duration::from_secs(5),
            },
        )
        .await;
        match result {
            Err(OpenAIError::Api(detail)) => {
                assert_eq!(serde_json::from_str::<serde_json::Value>(&detail).unwrap(), error)
            }
            other => panic!("unexpected result: {:?}", other.map_err(|e| e.to_string())),
        }
    }

    #[test]
    fn title_reply_ignores_unchanged_and_empty() {
        assert_eq!(title_from_reply("UNCHANGED".into()), None);
        assert_eq!(title_from_reply("unchanged".into()), None);
        assert_eq!(title_from_reply(String::new()), None);
        assert_eq!(title_from_reply("Basil care".into()), Some("Basil care".into()));
    }
}
