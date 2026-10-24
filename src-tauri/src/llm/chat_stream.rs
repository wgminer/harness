//! Streaming chat turn with tool rounds, on the OpenAI Responses API via genai.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use futures_util::StreamExt;
use genai::adapter::AdapterKind;
use genai::chat::{ChatOptions, ChatRequest, ChatStreamEvent, ContentPart};
use genai::Client;
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;

use super::messages::{genai_tools, response_items, to_genai_messages, tool_call_params};
use super::raw_frames::{with_raw_frames, RawFrames};
use super::{error_body, error_status, map_genai_error, openai_client, OPENAI_BASE_URL};
use crate::openai::{
    openai_chat_model, ChatMessageParam, OpenAIError, ToolCallExecContext, ToolCallParam,
    CHAT_REASONING_EFFORT, MAX_TOOL_CALL_ITERATIONS,
};

/// Cleared for the rest of the session if the API rejects reasoning summaries
/// (they can require organization verification); chat then runs without them.
static REASONING_SUMMARY_ENABLED: AtomicBool = AtomicBool::new(true);

pub struct OpenAIChatClient {
    client: Client,
}

/// What one streamed response produced.
#[derive(Default)]
struct RoundOutput {
    text: String,
    signatures: Vec<String>,
    tool_calls: Vec<ToolCallParam>,
}

fn round_options(with_summary: bool, has_tools: bool, frames: &RawFrames) -> ChatOptions {
    let mut reasoning = json!({ "effort": CHAT_REASONING_EFFORT });
    if with_summary {
        reasoning["summary"] = json!("auto");
    }
    let mut extra = json!({ "store": false, "reasoning": reasoning });
    if has_tools {
        extra["tool_choice"] = json!("auto");
    }
    let options = ChatOptions::default()
        .with_capture_content(true)
        .with_capture_tool_calls(true)
        // Also asks for `reasoning.encrypted_content`, replayed on the next round.
        .with_capture_reasoning_content(true)
        .with_extra_body(extra);
    with_raw_frames(options, frames)
}

fn is_summary_rejection(err: &genai::Error) -> bool {
    error_status(err) == Some(400)
        && error_body(err).is_some_and(|body| body.contains("summary"))
}

impl OpenAIChatClient {
    pub fn new(api_key: impl Into<String>) -> Result<Self, OpenAIError> {
        Self::with_base_url(&api_key.into(), OPENAI_BASE_URL)
    }

    fn with_base_url(api_key: &str, base_url: &str) -> Result<Self, OpenAIError> {
        Ok(Self {
            client: openai_client(
                AdapterKind::OpenAIResp,
                api_key,
                base_url,
                Duration::from_secs(300),
            )?,
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
        let request_tools = genai_tools(&tools);

        loop {
            if iteration >= MAX_TOOL_CALL_ITERATIONS {
                break;
            }
            iteration += 1;

            if cancel.is_cancelled() {
                return Err(OpenAIError::Cancelled);
            }

            let with_summary = REASONING_SUMMARY_ENABLED.load(Ordering::Relaxed);
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

            let mut request = ChatRequest::from_messages(to_genai_messages(&messages));
            if !request_tools.is_empty() {
                request = request.with_tools(request_tools.clone());
            }
            let frames = RawFrames::default();
            let options = round_options(with_summary, !request_tools.is_empty(), &frames);
            let model = openai_chat_model();

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
                        let mut calls = Vec::new();
                        for part in end.captured_content.map(|c| c.into_parts()).unwrap_or_default() {
                            match part {
                                ContentPart::ThoughtSignature(blob) => round.signatures.push(blob),
                                ContentPart::ToolCall(call) => calls.push(call),
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
                response_items: Some(response_items(
                    &round.signatures,
                    &round.text,
                    &round.tool_calls,
                )),
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
        let client = OpenAIChatClient::with_base_url("sk-test", base_url).unwrap();
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
}
