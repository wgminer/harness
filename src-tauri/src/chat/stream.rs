use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::Emitter;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::assistant_tools::is_assistant_tool_name;
use crate::conversation_title::schedule_conversation_title_refinement;
use crate::credentials::resolve_openai_api_key;
use crate::env_util::is_harness_e2e;
use crate::memory::{append_message, AppendMessageMeta, ToolCallRecord};
use crate::notes;
use crate::openai::{map_http_cancel, tool_error_result, ChatMessageParam, OpenAIChatClient};

use super::tool::{
    finalize_tool_calls_with_note_stream, finalize_tool_calls_with_note_stream_metadata,
    message_content_for_turn, strip_note_content_from_tool_calls,
};
use super::ChatController;

const HARNESS_E2E_ASSISTANT_REPLY: &str = "Harness E2E assistant reply.";

#[derive(Debug, Clone)]
pub(crate) struct NoteStreamState {
    pub note_id: String,
    pub title: String,
    pub summary: String,
    pub body: String,
    pub routing_active: bool,
}

impl ChatController {
    pub async fn stop(&self) {
        let guard = self.cancel_token.lock().await;
        if let Some(token) = guard.as_ref() {
            token.cancel();
        }
    }

    pub(crate) fn active_chat_model_label() -> String {
        crate::openai::openai_chat_model()
    }

    fn harness_e2e_stream_delay_ms() -> u64 {
        std::env::var("HARNESS_E2E_STREAM_MS")
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .filter(|ms| *ms > 0)
            .unwrap_or(0)
    }

    pub(crate) fn emit_stream_chunk(&self, conversation_id: &str, chunk: &str) {
        let _ = self.app.emit(
            "chat-stream-chunk",
            json!({ "conversationId": conversation_id, "chunk": chunk }),
        );
    }

    pub(crate) fn emit_stream_end(&self, conversation_id: &str) {
        let _ = self.app.emit(
            "chat-stream-end",
            json!({ "conversationId": conversation_id }),
        );
    }

    pub(crate) fn emit_tool_panel_update(
        &self,
        conversation_id: &str,
        tool_name: &str,
        payload: Value,
    ) {
        let _ = self.app.emit(
            "chat-tool-panel-update",
            json!({
                "conversationId": conversation_id,
                "toolName": tool_name,
                "payload": payload
            }),
        );
    }

    pub(crate) fn emit_note_stream_open(
        &self,
        conversation_id: &str,
        note_id: &str,
        title: &str,
        summary: &str,
    ) {
        let _ = self.app.emit(
            "chat-note-stream-open",
            json!({
                "conversationId": conversation_id,
                "noteId": note_id,
                "title": title,
                "summary": summary,
            }),
        );
    }

    pub(crate) fn emit_note_stream_chunk(&self, conversation_id: &str, note_id: &str, chunk: &str) {
        let _ = self.app.emit(
            "chat-note-stream-chunk",
            json!({
                "conversationId": conversation_id,
                "noteId": note_id,
                "chunk": chunk,
            }),
        );
    }

    pub(crate) fn emit_note_stream_close(&self, conversation_id: &str, note_id: &str) {
        let _ = self.app.emit(
            "chat-note-stream-close",
            json!({
                "conversationId": conversation_id,
                "noteId": note_id,
            }),
        );
    }

    pub(crate) async fn stream_assistant_reply(
        &self,
        conversation_id: &str,
        messages: Vec<ChatMessageParam>,
    ) -> Result<(), String> {
        if is_harness_e2e() {
            return self.stream_e2e_reply(conversation_id).await;
        }

        let api_key = resolve_openai_api_key().await.trim().to_string();
        if api_key.is_empty() {
            return Err("OpenAI API key required.".into());
        }

        let cancel = CancellationToken::new();
        {
            let mut guard = self.cancel_token.lock().await;
            *guard = Some(cancel.clone());
        }
        *self.note_stream.lock().unwrap() = None;

        let model_label = Self::active_chat_model_label();
        let tool_calls_this_turn = Arc::new(Mutex::new(Vec::<ToolCallRecord>::new()));
        let mut did_append_assistant = false;

        let client = OpenAIChatClient::new(api_key).map_err(|e| e.to_string())?;
        let conversation_id_owned = conversation_id.to_string();
        let controller = self.clone();
        let tool_calls_cb = tool_calls_this_turn.clone();

        let stream_result = client
            .send_message_with_tools(
                messages,
                |chunk| {
                    let mut guard = controller.note_stream.lock().unwrap();
                    if let Some(stream) = guard.as_mut() {
                        if stream.routing_active {
                            stream.body.push_str(chunk);
                            controller.emit_note_stream_chunk(
                                &conversation_id_owned,
                                &stream.note_id,
                                chunk,
                            );
                            return;
                        }
                    }
                    drop(guard);
                    controller.emit_stream_chunk(&conversation_id_owned, chunk);
                },
                {
                    let controller = controller.clone();
                    let conversation_id = conversation_id_owned.clone();
                    let tool_calls_cb = tool_calls_cb.clone();
                    move |name, args| {
                        let controller = controller.clone();
                        let conversation_id = conversation_id.clone();
                        let tool_calls_cb = tool_calls_cb.clone();
                        async move {
                            match controller
                                .execute_tool(&name, args, &conversation_id)
                                .await
                            {
                                Ok(result) => {
                                    if is_assistant_tool_name(&name) {
                                        let payload = serde_json::from_str::<Value>(&result)
                                            .unwrap_or_else(|_| json!(result));
                                        tool_calls_cb.lock().await.push(ToolCallRecord {
                                            tool_name: name,
                                            payload: Some(payload),
                                        });
                                    }
                                    result
                                }
                                Err(err) => tool_error_result(err),
                            }
                        }
                    }
                },
                &cancel,
            )
            .await;

        let stream_state = self.note_stream.lock().unwrap().take();
        if let Some(ref stream) = stream_state {
            self.emit_note_stream_close(conversation_id, &stream.note_id);
        }

        let captured_content = stream_result.as_ref().ok().cloned().unwrap_or_default();
        let mut tool_calls_this_turn = tool_calls_this_turn.lock().await.clone();
        if let Some(ref stream) = stream_state {
            if !stream.body.is_empty() {
                if let Ok(note) = notes::save_note(&self.state, &stream.note_id, &stream.body).await
                {
                    tool_calls_this_turn =
                        finalize_tool_calls_with_note_stream(tool_calls_this_turn, stream, &note);
                } else {
                    tool_calls_this_turn =
                        finalize_tool_calls_with_note_stream_metadata(tool_calls_this_turn, stream);
                }
            } else {
                tool_calls_this_turn =
                    finalize_tool_calls_with_note_stream_metadata(tool_calls_this_turn, stream);
            }
        } else {
            tool_calls_this_turn = strip_note_content_from_tool_calls(tool_calls_this_turn);
        }

        match stream_result {
            Ok(content) => {
                let message_content = message_content_for_turn(
                    stream_state.as_ref(),
                    &tool_calls_this_turn,
                    &content,
                );
                if !message_content.is_empty() || !tool_calls_this_turn.is_empty() {
                    append_message(
                        &self.state,
                        conversation_id,
                        "assistant",
                        &message_content,
                        Some(AppendMessageMeta {
                            timestamp: Some(chrono::Utc::now().timestamp_millis()),
                            model: Some(model_label.clone()),
                            tool_calls: if tool_calls_this_turn.is_empty() {
                                None
                            } else {
                                Some(tool_calls_this_turn)
                            },
                        }),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    did_append_assistant = true;
                }
            }
            Err(err) => {
                let is_abort = map_http_cancel(&err);
                if !captured_content.is_empty() || !tool_calls_this_turn.is_empty() {
                    let message_content = if let Some(ref stream) = stream_state {
                        stream.summary.clone()
                    } else if captured_content.is_empty() {
                        "[Error]".to_string()
                    } else {
                        message_content_for_turn(None, &tool_calls_this_turn, &captured_content)
                    };
                    append_message(
                        &self.state,
                        conversation_id,
                        "assistant",
                        &message_content,
                        Some(AppendMessageMeta {
                            timestamp: Some(chrono::Utc::now().timestamp_millis()),
                            model: Some(model_label.clone()),
                            tool_calls: if tool_calls_this_turn.is_empty() {
                                None
                            } else {
                                Some(tool_calls_this_turn)
                            },
                        }),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    did_append_assistant = true;
                } else if !is_abort {
                    append_message(
                        &self.state,
                        conversation_id,
                        "assistant",
                        &format!("[Error: {}]", err),
                        Some(AppendMessageMeta {
                            timestamp: Some(chrono::Utc::now().timestamp_millis()),
                            model: Some(model_label.clone()),
                            tool_calls: None,
                        }),
                    )
                    .await
                    .map_err(|e| e.to_string())?;
                    did_append_assistant = true;
                }
                // Persist + notify UI before returning so title refine still runs and
                // stream-end sync sees the appended assistant (not the previous turn).
                self.emit_stream_end(conversation_id);
                {
                    let mut guard = self.cancel_token.lock().await;
                    *guard = None;
                }
                if did_append_assistant {
                    schedule_conversation_title_refinement(
                        self.app.clone(),
                        self.state.clone(),
                        conversation_id.to_string(),
                    );
                }
                if !is_abort {
                    return Err(err.to_string());
                }
                return Ok(());
            }
        }

        // Emit end only after append so UI sync-from-storage sees this turn.
        self.emit_stream_end(conversation_id);

        {
            let mut guard = self.cancel_token.lock().await;
            *guard = None;
        }

        if did_append_assistant {
            schedule_conversation_title_refinement(
                self.app.clone(),
                self.state.clone(),
                conversation_id.to_string(),
            );
        }

        Ok(())
    }

    async fn stream_e2e_reply(&self, conversation_id: &str) -> Result<(), String> {
        let model_label = Self::active_chat_model_label();
        let synthetic = HARNESS_E2E_ASSISTANT_REPLY;
        let stream_delay_ms = Self::harness_e2e_stream_delay_ms();
        let cancel = CancellationToken::new();
        {
            let mut guard = self.cancel_token.lock().await;
            *guard = Some(cancel.clone());
        }

        let mut emitted = String::new();
        if stream_delay_ms == 0 {
            emitted = synthetic.to_string();
            self.emit_stream_chunk(conversation_id, synthetic);
        } else {
            for chunk in split_into_word_chunks(synthetic) {
                if cancel.is_cancelled() {
                    break;
                }
                emitted.push_str(&chunk);
                self.emit_stream_chunk(conversation_id, &chunk);
                tokio::time::sleep(Duration::from_millis(stream_delay_ms)).await;
            }
        }

        if !emitted.is_empty() {
            append_message(
                &self.state,
                conversation_id,
                "assistant",
                &emitted,
                Some(AppendMessageMeta {
                    timestamp: Some(chrono::Utc::now().timestamp_millis()),
                    model: Some(model_label),
                    tool_calls: None,
                }),
            )
            .await
            .map_err(|e| e.to_string())?;
            schedule_conversation_title_refinement(
                self.app.clone(),
                self.state.clone(),
                conversation_id.to_string(),
            );
        }

        self.emit_stream_end(conversation_id);

        {
            let mut guard = self.cancel_token.lock().await;
            *guard = None;
        }
        Ok(())
    }
}

pub(crate) fn activate_note_stream_from_payload(
    controller: &ChatController,
    conversation_id: &str,
    payload: &Value,
) {
    if payload.get("attachedToMessage").and_then(|v| v.as_bool()) != Some(true) {
        return;
    }
    let Some(note) = payload.get("note") else {
        return;
    };
    let Some(note_id) = note.get("id").and_then(|v| v.as_str()) else {
        return;
    };
    let title = note
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let summary = payload
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if summary.trim().is_empty() {
        return;
    }
    let content = note
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if !content.is_empty() {
        return;
    }

    let mut guard = controller.note_stream.lock().unwrap();
    if guard.is_some() {
        return;
    }
    *guard = Some(NoteStreamState {
        note_id: note_id.to_string(),
        title: title.clone(),
        summary: summary.clone(),
        body: String::new(),
        routing_active: true,
    });
    controller.emit_note_stream_open(conversation_id, note_id, &title, &summary);
}

fn split_into_word_chunks(content: &str) -> Vec<String> {
    let parts: Vec<&str> = content.split_whitespace().collect();
    let len = parts.len();
    if len <= 1 {
        return vec![content.to_string()];
    }
    parts
        .into_iter()
        .enumerate()
        .map(|(idx, word)| {
            if idx + 1 < len {
                format!("{word} ")
            } else {
                word.to_string()
            }
        })
        .collect()
}
