//! Streaming chat turn with tool rounds via genai: the OpenAI Responses API,
//! Claude's Messages API, or a local model's Chat Completions.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use genai::chat::{CacheControl, ChatOptions, ChatRequest, ChatStreamEvent, ContentPart, StopReason};
use genai::Client;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::messages::{genai_parts_item, genai_tools, response_items, to_genai_messages, tool_call_params};
use super::raw_frames::{with_raw_frames, RawFrames};
use super::{error_body, error_status, genai_client, map_genai_error, ModelTier, Provider, ProviderKind};
use crate::openai::{
    ChatMessageParam, OpenAIError, ToolCallExecContext, ToolCallParam, CHAT_REASONING_EFFORT,
    MAX_TOOL_CALL_ITERATIONS,
};

/// Room for adaptive thinking plus a long reply; Claude requires `max_tokens`.
const CLAUDE_CHAT_MAX_TOKENS: u32 = 64_000;

/// Shown when Claude declines a request and wrote nothing.
const CLAUDE_REFUSAL_TEXT: &str = "Claude declined to answer this request.";

/// Cleared for the rest of the session if the API rejects reasoning summaries
/// (they can require organization verification); chat then runs without them.
static REASONING_SUMMARY_ENABLED: AtomicBool = AtomicBool::new(true);

pub struct ChatClient {
    client: Client,
    provider: Provider,
}

/// What one streamed response produced.
#[derive(Default)]
struct RoundOutput {
    text: String,
    signatures: Vec<String>,
    tool_calls: Vec<ToolCallParam>,
    /// Everything genai captured, replayed as-is for non-OpenAI providers.
    parts: Vec<ContentPart>,
    refused: bool,
}

fn base_options() -> ChatOptions {
    ChatOptions::default()
        .with_capture_content(true)
        .with_capture_tool_calls(true)
        .with_capture_reasoning_content(true)
}

fn round_options(
    kind: ProviderKind,
    with_summary: bool,
    has_tools: bool,
    frames: &RawFrames,
) -> ChatOptions {
    match kind {
        ProviderKind::OpenAi => openai_round_options(with_summary, has_tools, frames),
        // Thinking stays on (it can't be turned off on the current Opus); summaries
        // stream into the reasoning panel. Low effort keeps chat replies quick.
        ProviderKind::Claude => base_options()
            .with_max_tokens(CLAUDE_CHAT_MAX_TOKENS)
            .with_cache_control(CacheControl::Ephemeral)
            .with_extra_body(json!({
                "thinking": { "type": "adaptive", "display": "summarized" },
                "output_config": { "effort": "low" }
            })),
        // Thinking models stream reasoning on their own; others would reject a level.
        ProviderKind::Local => base_options(),
    }
}

fn is_refusal(reason: &StopReason) -> bool {
    match reason {
        StopReason::ContentFilter(_) => true,
        StopReason::Other(raw) => raw == "refusal",
        _ => false,
    }
}

fn openai_round_options(with_summary: bool, has_tools: bool, frames: &RawFrames) -> ChatOptions {
    let mut reasoning = json!({ "effort": CHAT_REASONING_EFFORT });
    if with_summary {
        reasoning["summary"] = json!("auto");
    }
    let mut extra = json!({ "store": false, "reasoning": reasoning });
    if has_tools {
        extra["tool_choice"] = json!("auto");
    }
    // Capturing reasoning also asks for `reasoning.encrypted_content`, replayed on the next round.
    let options = base_options().with_extra_body(extra);
    with_raw_frames(options, frames)
}

fn is_summary_rejection(err: &genai::Error) -> bool {
    error_status(err) == Some(400)
        && error_body(err).is_some_and(|body| body.contains("summary"))
}

impl ChatClient {
    pub fn new(provider: &Provider) -> Result<Self, OpenAIError> {
        Ok(Self {
            client: genai_client(provider, true, Duration::from_secs(300))?,
            provider: provider.clone(),
        })
    }

    pub async fn send_message_with_tools<F, R, G, Fut>(
        &self,
        messages: Vec<ChatMessageParam>,
        tools: Value,
        on_content: F,
        on_reasoning: R,
        execute_tool: G,
        cancel: &CancellationToken,
    ) -> Result<String, OpenAIError>
    where
        F: FnMut(&str),
        R: FnMut(&str),
        G: Fn(String, Value, ToolCallExecContext) -> Fut,
        Fut: std::future::Future<Output = String>,
    {
        self.send_message_with_tools_from(
            messages,
            tools,
            String::new(),
            on_content,
            on_reasoning,
            execute_tool,
            cancel,
        )
        .await
    }

    /// Continue a tool loop from an existing message list and content prefix
    /// (used when resuming a gated approval after app restart).
    pub async fn send_message_with_tools_from<F, R, G, Fut>(
        &self,
        mut messages: Vec<ChatMessageParam>,
        tools: Value,
        initial_content: String,
        mut on_content: F,
        mut on_reasoning: R,
        execute_tool: G,
        cancel: &CancellationToken,
    ) -> Result<String, OpenAIError>
    where
        F: FnMut(&str),
        R: FnMut(&str),
        G: Fn(String, Value, ToolCallExecContext) -> Fut,
        Fut: std::future::Future<Output = String>,
    {
        let mut full_content = initial_content;
        let mut iteration = 0usize;
        let mut reasoning_emitted = false;
        let kind = self.provider.kind;
        let request_tools = genai_tools(&tools, kind);

        loop {
            if iteration >= MAX_TOOL_CALL_ITERATIONS {
                break;
            }
            iteration += 1;

            if cancel.is_cancelled() {
                return Err(OpenAIError::Cancelled);
            }

            let with_summary =
                kind == ProviderKind::OpenAi && REASONING_SUMMARY_ENABLED.load(Ordering::Relaxed);
            let mut emit_text = |delta: &str, full_content: &mut String, round: &mut RoundOutput| {
                full_content.push_str(delta);
                round.text.push_str(delta);
                on_content(delta);
            };
            let mut round_reasoning = String::new();
            let mut emit_reasoning = |delta: &str, round_reasoning: &mut String| {
                if delta.is_empty() {
                    return;
                }
                // Separate this round's reasoning from an earlier tool round's.
                if reasoning_emitted && round_reasoning.is_empty() {
                    on_reasoning("\n\n");
                }
                reasoning_emitted = true;
                round_reasoning.push_str(delta);
                on_reasoning(delta);
            };

            let mut request = ChatRequest::from_messages(to_genai_messages(&messages, kind));
            if !request_tools.is_empty() {
                request = request.with_tools(request_tools.clone());
            }
            let frames = RawFrames::default();
            let options = round_options(kind, with_summary, !request_tools.is_empty(), &frames);
            let model = self.provider.model(ModelTier::Chat);

            let started = tokio::select! {
                res = self.client.exec_chat_stream(&model, request, Some(&options)) => res,
                _ = cancel.cancelled() => return Err(OpenAIError::Cancelled),
            };
            let mut stream = match started {
                Ok(res) => res.stream,
                Err(err) if with_summary && is_summary_rejection(&err) => {
                    REASONING_SUMMARY_ENABLED.store(false, Ordering::Relaxed);
                    iteration -= 1;
                    continue;
                }
                Err(err) => return Err(map_genai_error(err)),
            };

            let mut round = RoundOutput::default();
            let mut retry_without_summary = false;
            loop {
                let event = tokio::select! {
                    event = stream.next() => event,
                    _ = cancel.cancelled() => return Err(OpenAIError::Cancelled),
                };
                let Some(event) = event else {
                    break;
                };
                let event = match event {
                    Ok(event) => event,
                    // Streamed calls report a rejected request here, not at the start.
                    Err(err) if with_summary && round.text.is_empty() && is_summary_rejection(&err) => {
                        retry_without_summary = true;
                        break;
                    }
                    Err(err) => return Err(map_genai_error(err)),
                };

                let (part_break, fallback, refusal) = {
                    let mut state = frames.lock().unwrap();
                    let part_break = matches!(event, ChatStreamEvent::ReasoningChunk(_))
                        && std::mem::take(&mut state.part_break_pending);
                    (
                        part_break,
                        std::mem::take(&mut state.fallback_reasoning),
                        std::mem::take(&mut state.refusal_text),
                    )
                };

                match event {
                    ChatStreamEvent::Chunk(chunk) => {
                        emit_text(&chunk.content, &mut full_content, &mut round);
                    }
                    ChatStreamEvent::ReasoningChunk(chunk) => {
                        if part_break && !round_reasoning.is_empty() {
                            emit_reasoning("\n\n", &mut round_reasoning);
                        }
                        emit_reasoning(&chunk.content, &mut round_reasoning);
                    }
                    ChatStreamEvent::End(end) => {
                        round.refused = end.captured_stop_reason.as_ref().is_some_and(is_refusal);
                        let mut calls = Vec::new();
                        round.parts = end.captured_content.map(|c| c.into_parts()).unwrap_or_default();
                        for part in &round.parts {
                            match part {
                                ContentPart::ThoughtSignature(blob) => round.signatures.push(blob.clone()),
                                ContentPart::ToolCall(call) => calls.push(call.clone()),
                                _ => {}
                            }
                        }
                        if round.signatures.is_empty() {
                            for call in &calls {
                                for blob in call.thought_signatures.iter().flatten() {
                                    if !round.signatures.contains(blob) {
                                        round.signatures.push(blob.clone());
                                    }
                                }
                            }
                        }
                        round.tool_calls = tool_call_params(&calls);
                    }
                    _ => {}
                }

                for summary in fallback {
                    let chunk = if round_reasoning.is_empty() {
                        summary
                    } else {
                        format!("\n\n{summary}")
                    };
                    emit_reasoning(&chunk, &mut round_reasoning);
                }
                for delta in refusal {
                    emit_text(&delta, &mut full_content, &mut round);
                }
            }

            if retry_without_summary {
                REASONING_SUMMARY_ENABLED.store(false, Ordering::Relaxed);
                iteration -= 1;
                continue;
            }
            if round.refused && round.text.is_empty() {
                emit_text(CLAUDE_REFUSAL_TEXT, &mut full_content, &mut round);
            }
            if round.tool_calls.is_empty() {
                break;
            }

            messages.push(ChatMessageParam {
                role: "assistant".into(),
                content: if round.text.is_empty() {
                    None
                } else {
                    Some(round.text.clone())
                },
                tool_calls: Some(round.tool_calls.clone()),
                tool_call_id: None,
                response_items: Some(match kind {
                    ProviderKind::OpenAi => {
                        response_items(&round.signatures, &round.text, &round.tool_calls)
                    }
                    _ => vec![genai_parts_item(kind, &round.parts)],
                }),
            });

            let tool_calls = round.tool_calls;
            for (index, tc) in tool_calls.iter().enumerate() {
                if cancel.is_cancelled() {
                    return Err(OpenAIError::Cancelled);
                }
                let args: Value =
                    serde_json::from_str(&tc.function.arguments).unwrap_or_else(|_| json!({}));
                let ctx = ToolCallExecContext {
                    tool_call_id: tc.id.clone(),
                    messages_before_result: messages.clone(),
                    remaining_tool_calls: tool_calls[index + 1..].to_vec(),
                    content_so_far: full_content.clone(),
                };
                let result = execute_tool(tc.function.name.clone(), args, ctx).await;
                messages.push(ChatMessageParam {
                    role: "tool".into(),
                    content: Some(result),
                    tool_calls: None,
                    tool_call_id: Some(tc.id.clone()),
                    response_items: None,
                });
            }
        }

        Ok(full_content)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::super::test_server::{completed, serve, Reply};
    use super::*;

    fn user(content: &str) -> ChatMessageParam {
        ChatMessageParam {
            role: "user".into(),
            content: Some(content.into()),
            tool_calls: None,
            tool_call_id: None,
            response_items: None,
        }
    }

    fn tool_round_reply() -> Reply {
        let reasoning = json!({ "type": "reasoning", "id": "rs_1", "encrypted_content": "enc_1", "summary": [] });
        let call = json!({ "type": "function_call", "id": "fc_1", "call_id": "call_a",
            "name": "get_datetime", "arguments": "{\"timezone\":\"UTC\"}" });
        Reply::sse(&[
            json!({ "type": "response.created", "response": {} }),
            json!({ "type": "response.output_item.added", "output_index": 0, "item": { "type": "reasoning", "id": "rs_1" } }),
            json!({ "type": "response.reasoning_summary_part.added" }),
            json!({ "type": "response.reasoning_summary_text.delta", "delta": "**Checking**" }),
            json!({ "type": "response.reasoning_summary_part.added" }),
            json!({ "type": "response.reasoning_summary_text.delta", "delta": "**Calling**" }),
            json!({ "type": "response.output_item.done", "output_index": 0, "item": reasoning }),
            json!({ "type": "response.output_item.added", "output_index": 1, "item": call }),
            json!({ "type": "response.output_item.done", "output_index": 1, "item": call }),
            completed(json!([reasoning, call])),
        ])
    }

    fn text_reply(text: &str) -> Reply {
        let message = json!({ "type": "message", "role": "assistant",
            "content": [{ "type": "output_text", "text": text }] });
        Reply::sse(&[
            json!({ "type": "response.output_item.added", "output_index": 0, "item": { "type": "reasoning", "id": "rs_2" } }),
            json!({ "type": "response.output_item.done", "output_index": 0, "item": {
                "type": "reasoning", "id": "rs_2", "summary": [{ "type": "summary_text", "text": "Done" }] } }),
            json!({ "type": "response.output_text.delta", "delta": text }),
            completed(json!([message])),
        ])
    }

    struct Run {
        result: Result<String, OpenAIError>,
        content: String,
        reasoning: String,
        tool_calls: Vec<(String, Value)>,
    }

    async fn run(base_url: &str, tools: Value, cancel: &CancellationToken) -> Run {
        run_with(Provider::for_test(ProviderKind::OpenAi, base_url, ""), tools, cancel).await
    }

    async fn run_with(provider: Provider, tools: Value, cancel: &CancellationToken) -> Run {
        let client = ChatClient::new(&provider).unwrap();
        let content = Arc::new(Mutex::new(String::new()));
        let reasoning = Arc::new(Mutex::new(String::new()));
        let calls = Arc::new(Mutex::new(Vec::new()));
        let result = client
            .send_message_with_tools(
                vec![user("What time is it?")],
                tools,
                |chunk| content.lock().unwrap().push_str(chunk),
                |chunk| reasoning.lock().unwrap().push_str(chunk),
                |name, args, _ctx| {
                    calls.lock().unwrap().push((name, args));
                    async { json!({ "iso": "2026-10-24T12:00:00Z" }).to_string() }
                },
                cancel,
            )
            .await;
        let content = content.lock().unwrap().clone();
        let reasoning = reasoning.lock().unwrap().clone();
        let tool_calls = calls.lock().unwrap().clone();
        Run { result, content, reasoning, tool_calls }
    }

    /// One test, because the summary fallback flag is process-wide.
    #[tokio::test]
    async fn tool_round_replays_reasoning_and_falls_back_without_summaries() {
        let (base_url, bodies) = serve(vec![tool_round_reply(), text_reply("It's noon.")]).await;
        let out = run(&base_url, crate::openai::tool_definitions(), &CancellationToken::new()).await;

        assert_eq!(out.result.unwrap(), "It's noon.");
        assert_eq!(out.content, "It's noon.");
        assert_eq!(out.reasoning, "**Checking**\n\n**Calling**\n\nDone");
        assert_eq!(out.tool_calls, vec![("get_datetime".to_string(), json!({ "timezone": "UTC" }))]);

        let bodies = bodies.lock().unwrap().clone();
        let first = &bodies[0];
        assert_eq!(first["store"], false);
        assert_eq!(first["reasoning"], json!({ "effort": "low", "summary": "auto" }));
        assert_eq!(first["include"], json!(["reasoning.encrypted_content"]));
        assert_eq!(first["tool_choice"], "auto");
        let tools = first["tools"].as_array().unwrap();
        assert_eq!(tools.len(), crate::openai::tool_definitions().as_array().unwrap().len());
        assert!(tools.iter().all(|t| t["type"] == "function" && t["strict"] == false), "{}", tools[0]);

        let input = bodies[1]["input"].as_array().unwrap();
        let types: Vec<&str> = input.iter().filter_map(|i| i["type"].as_str()).collect();
        assert_eq!(&types[types.len() - 3..], ["reasoning", "function_call", "function_call_output"]);
        let replayed = &input[input.len() - 3];
        assert_eq!(replayed["encrypted_content"], "enc_1");
        assert_eq!(input[input.len() - 1]["call_id"], "call_a");

        // A rejected reasoning summary retries the same round without one.
        let rejection = json!({ "error": { "message": "Your organization must be verified to generate reasoning summaries.", "param": "reasoning.summary" } });
        let (base_url, bodies) = serve(vec![Reply::json(400, rejection), text_reply("Hi.")]).await;
        let out = run(&base_url, json!([]), &CancellationToken::new()).await;
        REASONING_SUMMARY_ENABLED.store(true, Ordering::Relaxed);
        assert_eq!(out.result.unwrap(), "Hi.");
        let bodies = bodies.lock().unwrap().clone();
        assert_eq!(bodies.len(), 2);
        assert_eq!(bodies[1]["reasoning"], json!({ "effort": "low" }));
        assert!(bodies[1].get("tools").is_none());
        assert!(bodies[1].get("tool_choice").is_none());
    }

    #[tokio::test]
    async fn api_errors_keep_the_response_body() {
        let body = json!({ "error": { "message": "Incorrect API key provided.", "code": "invalid_api_key" } });
        let (base_url, _) = serve(vec![Reply::json(401, body.clone())]).await;
        let out = run(&base_url, json!([]), &CancellationToken::new()).await;
        match out.result {
            Err(OpenAIError::Api(detail)) => assert_eq!(serde_json::from_str::<Value>(&detail).unwrap_or_else(|_| panic!("detail: {detail}")), body),
            other => panic!("unexpected result: {:?}", other.map_err(|e| e.to_string())),
        }
    }

    #[tokio::test]
    async fn failed_response_reports_its_message() {
        let failed = json!({ "type": "response.failed", "response": {
            "id": "resp_1", "status": "failed", "model": "test-model", "error": { "message": "boom" } } });
        let (base_url, _) = serve(vec![Reply::sse(&[failed])]).await;
        let out = run(&base_url, json!([]), &CancellationToken::new()).await;
        assert_eq!(out.result.map_err(|e| e.to_string()), Err("boom".to_string()));
    }

    #[tokio::test]
    async fn refusal_text_streams_as_content() {
        let (base_url, _) = serve(vec![Reply::sse(&[
            json!({ "type": "response.refusal.delta", "delta": "I can't help with that." }),
            completed(json!([])),
        ])])
        .await;
        let out = run(&base_url, json!([]), &CancellationToken::new()).await;
        assert_eq!(out.result.unwrap(), "I can't help with that.");
    }

    #[tokio::test]
    async fn cancelled_turn_stops_before_sending() {
        let cancel = CancellationToken::new();
        cancel.cancel();
        let out = run("http://127.0.0.1:9/v1/", json!([]), &cancel).await;
        assert!(matches!(out.result, Err(OpenAIError::Cancelled)));
    }

    fn claude_tool_round_reply() -> Reply {
        Reply::sse(&[
            json!({ "type": "message_start", "message": { "id": "msg_1", "type": "message", "role": "assistant",
                "model": "claude-opus-5-5", "content": [], "stop_reason": null,
                "usage": { "input_tokens": 10, "output_tokens": 1 } } }),
            json!({ "type": "content_block_start", "index": 0,
                "content_block": { "type": "thinking", "thinking": "", "signature": "" } }),
            json!({ "type": "content_block_delta", "index": 0,
                "delta": { "type": "thinking_delta", "thinking": "Checking the date." } }),
            json!({ "type": "content_block_delta", "index": 0,
                "delta": { "type": "signature_delta", "signature": "sig_1" } }),
            json!({ "type": "content_block_stop", "index": 0 }),
            json!({ "type": "content_block_start", "index": 1,
                "content_block": { "type": "tool_use", "id": "toolu_1", "name": "get_datetime", "input": {} } }),
            json!({ "type": "content_block_delta", "index": 1,
                "delta": { "type": "input_json_delta", "partial_json": "{\"timezone\":\"UTC\"}" } }),
            json!({ "type": "content_block_stop", "index": 1 }),
            json!({ "type": "message_delta", "delta": { "stop_reason": "tool_use" }, "usage": { "output_tokens": 20 } }),
            json!({ "type": "message_stop" }),
        ])
    }

    fn claude_text_reply(text: &str, stop_reason: &str) -> Reply {
        let mut events = vec![json!({ "type": "message_start", "message": { "id": "msg_2", "type": "message",
            "role": "assistant", "model": "claude-opus-5-5", "content": [], "stop_reason": null,
            "usage": { "input_tokens": 10, "output_tokens": 1 } } })];
        if !text.is_empty() {
            events.push(json!({ "type": "content_block_start", "index": 0, "content_block": { "type": "text", "text": "" } }));
            events.push(json!({ "type": "content_block_delta", "index": 0, "delta": { "type": "text_delta", "text": text } }));
            events.push(json!({ "type": "content_block_stop", "index": 0 }));
        }
        events.push(json!({ "type": "message_delta", "delta": { "stop_reason": stop_reason }, "usage": { "output_tokens": 5 } }));
        events.push(json!({ "type": "message_stop" }));
        Reply::sse(&events)
    }

    #[tokio::test]
    async fn claude_tool_round_replays_its_thinking_block() {
        let (base_url, bodies) =
            serve(vec![claude_tool_round_reply(), claude_text_reply("It's noon.", "end_turn")]).await;
        let provider = Provider::for_test(ProviderKind::Claude, &base_url, "");
        let out = run_with(provider, crate::openai::tool_definitions(), &CancellationToken::new()).await;

        assert_eq!(out.result.unwrap(), "It's noon.");
        assert_eq!(out.reasoning, "Checking the date.");
        assert_eq!(out.tool_calls, vec![("get_datetime".to_string(), json!({ "timezone": "UTC" }))]);

        let bodies = bodies.lock().unwrap().clone();
        let first = &bodies[0];
        assert_eq!(first["model"], "claude-opus-5-5");
        assert_eq!(first["max_tokens"], CLAUDE_CHAT_MAX_TOKENS);
        assert_eq!(first["thinking"], json!({ "type": "adaptive", "display": "summarized" }));
        assert_eq!(first["output_config"], json!({ "effort": "low" }));
        assert!(first.get("temperature").is_none());
        let tools = first["tools"].as_array().unwrap();
        assert!(tools.iter().all(|t| t["input_schema"].is_object() && t.get("strict").is_none()), "{}", tools[0]);
        let web_search = tools.iter().find(|t| t["name"] == "web_search").unwrap();
        assert_eq!(web_search["type"], "custom");

        let messages = bodies[1]["messages"].as_array().unwrap();
        let assistant = messages.iter().find(|m| m["role"] == "assistant").unwrap();
        let blocks = assistant["content"].as_array().unwrap();
        assert_eq!(blocks[0]["type"], "thinking");
        assert_eq!(blocks[0]["signature"], "sig_1");
        assert!(blocks.iter().any(|b| b["type"] == "tool_use" && b["id"] == "toolu_1"));
        let last = messages.last().unwrap();
        assert_eq!(last["role"], "user");
        assert_eq!(last["content"][0]["type"], "tool_result");
        assert_eq!(last["content"][0]["tool_use_id"], "toolu_1");
    }

    #[tokio::test]
    async fn claude_refusal_without_text_says_so() {
        let (base_url, _) = serve(vec![claude_text_reply("", "refusal")]).await;
        let provider = Provider::for_test(ProviderKind::Claude, &base_url, "");
        let out = run_with(provider, json!([]), &CancellationToken::new()).await;
        assert_eq!(out.result.unwrap(), CLAUDE_REFUSAL_TEXT);
    }

    #[tokio::test]
    async fn local_tool_round_on_chat_completions() {
        let chunk = |delta: Value, finish: Value| {
            json!({ "id": "c1", "object": "chat.completion.chunk", "created": 0, "model": "qwen3:4b",
                "choices": [{ "index": 0, "delta": delta, "finish_reason": finish }] })
        };
        let first = Reply::sse_data(&[
            chunk(json!({ "role": "assistant", "reasoning": "Need the time." }), Value::Null),
            chunk(json!({ "tool_calls": [{ "index": 0, "id": "call_1", "type": "function",
                "function": { "name": "get_datetime", "arguments": "{}" } }] }), Value::Null),
            chunk(json!({}), json!("tool_calls")),
        ]);
        let second = Reply::sse_data(&[
            chunk(json!({ "role": "assistant", "content": "Noon." }), Value::Null),
            chunk(json!({}), json!("stop")),
        ]);
        let (base_url, bodies) = serve(vec![first, second]).await;
        let provider = Provider::for_test(ProviderKind::Local, &base_url, "qwen3:4b");
        let out = run_with(provider, crate::openai::tool_definitions(), &CancellationToken::new()).await;

        assert_eq!(out.result.unwrap(), "Noon.");
        assert_eq!(out.reasoning, "Need the time.");
        assert_eq!(out.tool_calls.len(), 1);

        let bodies = bodies.lock().unwrap().clone();
        assert_eq!(bodies[0]["model"], "qwen3:4b");
        assert!(bodies[0].get("reasoning_effort").is_none());
        let web_search = bodies[0]["tools"].as_array().unwrap().iter()
            .find(|t| t["function"]["name"] == "web_search").cloned().unwrap();
        assert_eq!(web_search["type"], "function");
        let messages = bodies[1]["messages"].as_array().unwrap();
        let last = messages.last().unwrap();
        assert_eq!(last["role"], "tool");
        assert_eq!(last["tool_call_id"], "call_1");
    }
}
