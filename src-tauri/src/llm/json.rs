//! One-shot calls (titles, JSON helpers, transcript cleanup) via genai: Chat
//! Completions for OpenAI and local models, Messages for Claude.

use std::time::Duration;

use genai::chat::{ChatMessage, ChatOptions, ChatRequest, ChatResponseFormat};
use serde_json::json;

use super::{genai_client, map_genai_error, ModelTier, Provider, ProviderKind};
use crate::openai::OpenAIError;

const TITLE_SYSTEM_PROMPT: &str = "You name chat threads for a sidebar. Reply with a short, descriptive title (a few words). \
No quotes or extra punctuation. \
If the previous title still fits the recent conversation, reply with exactly: UNCHANGED";

/// Claude needs `max_tokens`, and thinking shares it with the reply.
const CLAUDE_MIN_MAX_TOKENS: u32 = 16_000;

pub struct Completion<'a> {
    pub tier: ModelTier,
    pub system: &'a str,
    pub user: &'a str,
    /// OpenAI's `max_completion_tokens`; `None` leaves the provider default.
    pub max_tokens: Option<u32>,
    /// OpenAI effort keyword; `"none"` turns reasoning off where the provider allows.
    pub reasoning_effort: &'a str,
    pub json: bool,
    pub timeout: Duration,
}

fn options_for(kind: ProviderKind, req: &Completion<'_>) -> ChatOptions {
    let reasoning_off = req.reasoning_effort == "none";
    let mut options = ChatOptions::default();
    match kind {
        // Exact Chat Completions fields, so genai doesn't remap them by model name.
        ProviderKind::OpenAi => {
            let mut extra = json!({ "reasoning_effort": req.reasoning_effort });
            if let Some(max) = req.max_tokens {
                extra["max_completion_tokens"] = json!(max);
            }
            options = options.with_extra_body(extra);
        }
        // Thinking models such as qwen3 keep reasoning with thinking "off" and write it
        // into the reply instead, so only JSON mode (which holds the output to JSON)
        // turns it off. Text calls think, uncapped, so the reply isn't cut off.
        ProviderKind::Local if req.json => {
            if let Some(max) = req.max_tokens {
                options = options.with_max_tokens(max);
            }
            if reasoning_off {
                options = options.with_extra_body(json!({ "reasoning_effort": "none" }));
            }
        }
        ProviderKind::Local => {}
        ProviderKind::Claude => {
            // The current Opus can't turn thinking off, so only small calls do.
            let thinking_off = reasoning_off && !matches!(req.tier, ModelTier::Chat);
            let (thinking, effort, max) = if thinking_off {
                (json!({ "type": "disabled" }), "low", req.max_tokens.unwrap_or(CLAUDE_MIN_MAX_TOKENS))
            } else {
                let effort = if reasoning_off { "low" } else { req.reasoning_effort };
                let max = req.max_tokens.unwrap_or(0).max(CLAUDE_MIN_MAX_TOKENS);
                (json!({ "type": "adaptive" }), effort, max)
            };
            options = options
                .with_max_tokens(max)
                .with_extra_body(json!({ "thinking": thinking, "output_config": { "effort": effort } }));
        }
    }
    // Claude has no JSON mode; the prompts ask for JSON and fences are stripped.
    if req.json && kind != ProviderKind::Claude {
        options = options.with_response_format(ChatResponseFormat::JsonMode);
    }
    options
}

/// Text inside a leading/trailing ``` fence, which Claude sometimes adds to JSON.
fn strip_code_fence(text: &str) -> &str {
    let trimmed = text.trim();
    let Some(rest) = trimmed.strip_prefix("```") else {
        return trimmed;
    };
    let Some(body) = rest.strip_suffix("```") else {
        return trimmed;
    };
    let body = body.strip_prefix("json").unwrap_or(body);
    body.trim()
}

/// Local models run slower than the hosted ones the timeouts were tuned for.
const LOCAL_MIN_TIMEOUT: Duration = Duration::from_secs(120);

pub async fn complete(provider: &Provider, req: Completion<'_>) -> Result<String, OpenAIError> {
    let timeout = match provider.kind {
        ProviderKind::Local => (req.timeout * 4).max(LOCAL_MIN_TIMEOUT),
        _ => req.timeout,
    };
    let client = genai_client(provider, false, timeout)?;
    let request = ChatRequest::from_messages(vec![
        ChatMessage::system(req.system),
        ChatMessage::user(req.user),
    ]);
    let options = options_for(provider.kind, &req);
    let response = client
        .exec_chat(&provider.model(req.tier), request, Some(&options))
        .await
        .map_err(map_genai_error)?;
    let text = response.first_text().unwrap_or("").trim();
    Ok(if req.json { strip_code_fence(text) } else { text }.to_string())
}

pub async fn generate_thread_title(
    provider: &Provider,
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
        provider,
        Completion {
            tier: ModelTier::Small,
            system: TITLE_SYSTEM_PROMPT,
            user: &user_block,
            max_tokens: Some(512),
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

#[cfg(test)]
mod tests {
    use super::super::test_server::{serve, Reply};
    use super::*;
    use serde_json::Value;

    fn json_request(tier: ModelTier, effort: &'static str) -> Completion<'static> {
        Completion {
            tier,
            system: "Reply in JSON.",
            user: "basil",
            max_tokens: Some(300),
            reasoning_effort: effort,
            json: true,
            timeout: Duration::from_secs(5),
        }
    }

    fn chat_completion(content: &str) -> Value {
        json!({
            "id": "chatcmpl_1", "object": "chat.completion", "created": 0, "model": "m",
            "choices": [{ "index": 0, "finish_reason": "stop",
                "message": { "role": "assistant", "content": content } }]
        })
    }

    #[tokio::test]
    async fn openai_json_call_sends_chat_completions_fields() {
        let (base_url, bodies) =
            serve(vec![Reply::json(200, chat_completion("  {\"title\":\"Basil\"}\n"))]).await;
        let provider = Provider::for_test(ProviderKind::OpenAi, &base_url, "");
        let text = complete(&provider, json_request(ModelTier::Small, "none")).await.unwrap();
        assert_eq!(text, "{\"title\":\"Basil\"}");

        let body = bodies.lock().unwrap()[0].clone();
        assert_eq!(body["model"], crate::openai::openai_title_model());
        assert_eq!(body["response_format"], json!({ "type": "json_object" }));
        assert_eq!(body["max_completion_tokens"], 300);
        assert_eq!(body["reasoning_effort"], "none");
        assert!(body.get("max_tokens").is_none());
        assert_eq!(body["messages"][0]["role"], "system");
        assert_eq!(body["messages"][0]["content"], "Reply in JSON.");
        assert_eq!(body["messages"][1]["role"], "user");
    }

    #[tokio::test]
    async fn local_json_call_turns_thinking_off() {
        let (base_url, bodies) = serve(vec![Reply::json(200, chat_completion("{\"ok\":true}"))]).await;
        let provider = Provider::for_test(ProviderKind::Local, &base_url, "qwen3:4b");
        assert_eq!(complete(&provider, json_request(ModelTier::Small, "none")).await.unwrap(), "{\"ok\":true}");
        let body = bodies.lock().unwrap()[0].clone();
        assert_eq!(body["model"], "qwen3:4b");
        assert_eq!(body["reasoning_effort"], "none");
        assert_eq!(body["response_format"], json!({ "type": "json_object" }));
    }

    #[tokio::test]
    async fn claude_json_call_strips_fences_and_sets_thinking() {
        let reply = json!({
            "id": "msg_1", "type": "message", "role": "assistant", "model": "claude-haiku-5-5",
            "content": [{ "type": "text", "text": "```json\n{\"ok\":true}\n```" }],
            "stop_reason": "end_turn", "usage": { "input_tokens": 5, "output_tokens": 5 }
        });
        let (base_url, bodies) = serve(vec![Reply::json(200, reply.clone()), Reply::json(200, reply)]).await;
        let provider = Provider::for_test(ProviderKind::Claude, &base_url, "");

        assert_eq!(complete(&provider, json_request(ModelTier::Small, "none")).await.unwrap(), "{\"ok\":true}");
        complete(&provider, json_request(ModelTier::Chat, "low")).await.unwrap();

        let bodies = bodies.lock().unwrap().clone();
        assert_eq!(bodies[0]["model"], "claude-haiku-5-5");
        assert_eq!(bodies[0]["thinking"], json!({ "type": "disabled" }));
        assert_eq!(bodies[0]["max_tokens"], 300);
        assert_eq!(bodies[0]["system"], "Reply in JSON.");
        assert!(bodies[0].get("response_format").is_none());
        assert_eq!(bodies[1]["model"], "claude-opus-5-5");
        assert_eq!(bodies[1]["thinking"], json!({ "type": "adaptive" }));
        assert_eq!(bodies[1]["output_config"], json!({ "effort": "low" }));
        assert_eq!(bodies[1]["max_tokens"], CLAUDE_MIN_MAX_TOKENS);
    }

    #[tokio::test]
    async fn json_call_errors_keep_the_response_body() {
        let error = json!({ "error": { "message": "Rate limit reached." } });
        let (base_url, _) = serve(vec![Reply::json(429, error.clone())]).await;
        let provider = Provider::for_test(ProviderKind::OpenAi, &base_url, "");
        match complete(&provider, json_request(ModelTier::Small, "none")).await {
            Err(OpenAIError::Api(detail)) => {
                assert_eq!(serde_json::from_str::<Value>(&detail).unwrap(), error)
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

    #[test]
    fn strips_json_fences_only() {
        assert_eq!(strip_code_fence("```json\n{\"a\":1}\n```"), "{\"a\":1}");
        assert_eq!(strip_code_fence("```\n[]\n```"), "[]");
        assert_eq!(strip_code_fence(" {\"a\":1} "), "{\"a\":1}");
    }
}
