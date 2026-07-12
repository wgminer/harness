use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use regex::Regex;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, oneshot};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::assistant_tools::{execute_assistant_tool, is_assistant_tool_name};
use crate::conversation_title::schedule_conversation_title_refinement;
use crate::credentials::resolve_openai_api_key;
use crate::customization::{execute_customization_tool, is_customization_tool_name};
use crate::env_util::is_harness_e2e;
use crate::file_tools::execute_file_tool;
use crate::memory::{
    append_message, get_messages, get_user_memory, pop_last_user_message, AppendMessageMeta,
    AppState, ToolCallRecord,
};
use crate::notes;
use crate::openai::{map_http_cancel, ChatMessageParam, OpenAIChatClient, OpenAIError};
use crate::settings;
use crate::system_prompt::{
    build_system_prompt, fields_from_settings, SystemPromptPreview, SystemPromptPreviewFact,
};

const DICTATION_POLISH_INSTRUCTION: &str =
    "Polish and clarify the following dictation. Fix grammar and wording; keep the meaning. Reply with a clear, concise version.";

const HARNESS_E2E_ASSISTANT_REPLY: &str = "Harness E2E assistant reply.";

const MEMORY_STOPWORDS: &[&str] = &[
    "a", "an", "and", "are", "as", "at", "be", "but", "by", "for", "from", "how", "i", "if", "in",
    "is", "it", "me", "my", "of", "on", "or", "that", "the", "this", "to", "was", "we", "with",
    "you", "your",
];

const MEMORY_ALWAYS_RELEVANT_KEY_PARTS: &[&str] =
    &["writing", "tone", "style", "voice", "goal", "audience", "constraint"];
const RELEVANT_MAX_ENTRIES: usize = 6;
const RELEVANT_MAX_CHARS: usize = 900;
const RELEVANT_MIN_SCORE: f64 = 0.65;
const BUDGET_MAX_CHARS: usize = 900;
const RELEVANT_FALLBACK_COUNT: usize = 3;

struct PendingGatedTool {
    tool: String,
    args: Value,
    respond_to: oneshot::Sender<String>,
}

#[derive(Debug, Clone)]
struct NoteStreamState {
    note_id: String,
    title: String,
    summary: String,
    body: String,
    routing_active: bool,
}

#[derive(Clone)]
pub struct ChatController {
    app: AppHandle,
    state: AppState,
    cancel_token: Arc<Mutex<Option<CancellationToken>>>,
    pending_gated: Arc<Mutex<HashMap<String, PendingGatedTool>>>,
    note_stream: Arc<std::sync::Mutex<Option<NoteStreamState>>>,
}

impl ChatController {
    pub fn new(app: AppHandle, state: AppState) -> Self {
        Self {
            app,
            state,
            cancel_token: Arc::new(Mutex::new(None)),
            pending_gated: Arc::new(Mutex::new(HashMap::new())),
            note_stream: Arc::new(std::sync::Mutex::new(None)),
        }
    }

    fn active_chat_model_label() -> String {
        crate::openai::openai_chat_model()
    }

    fn harness_e2e_stream_delay_ms() -> u64 {
        std::env::var("HARNESS_E2E_STREAM_MS")
            .ok()
            .and_then(|raw| raw.parse::<u64>().ok())
            .filter(|ms| *ms > 0)
            .unwrap_or(0)
    }

    fn emit_stream_chunk(&self, conversation_id: &str, chunk: &str) {
        let _ = self.app.emit(
            "chat-stream-chunk",
            json!({ "conversationId": conversation_id, "chunk": chunk }),
        );
    }

    fn emit_stream_end(&self, conversation_id: &str) {
        let _ = self.app.emit(
            "chat-stream-end",
            json!({ "conversationId": conversation_id }),
        );
    }

    fn emit_tool_panel_update(&self, conversation_id: &str, tool_name: &str, payload: Value) {
        let _ = self.app.emit(
            "chat-tool-panel-update",
            json!({
                "conversationId": conversation_id,
                "toolName": tool_name,
                "payload": payload
            }),
        );
    }

    fn emit_note_stream_open(
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

    fn emit_note_stream_chunk(&self, conversation_id: &str, note_id: &str, chunk: &str) {
        let _ = self.app.emit(
            "chat-note-stream-chunk",
            json!({
                "conversationId": conversation_id,
                "noteId": note_id,
                "chunk": chunk,
            }),
        );
    }

    fn emit_note_stream_close(&self, conversation_id: &str, note_id: &str) {
        let _ = self.app.emit(
            "chat-note-stream-close",
            json!({
                "conversationId": conversation_id,
                "noteId": note_id,
            }),
        );
    }

    pub async fn stop(&self) {
        let guard = self.cancel_token.lock().await;
        if let Some(token) = guard.as_ref() {
            token.cancel();
        }
    }

    pub async fn resolve_gated_tool(&self, pending_id: &str, action: &str) {
        let pending = {
            let mut map = self.pending_gated.lock().await;
            map.remove(pending_id)
        };
        let Some(pending) = pending else {
            return;
        };
        let result = if action == "proceed" {
            execute_assistant_tool(&self.state, &pending.tool, pending.args)
                .await
                .unwrap_or_else(|e| json!({ "error": e.to_string() }).to_string())
        } else {
            json!({ "cancelled": true, "message": "User cancelled the action." }).to_string()
        };
        let _ = pending.respond_to.send(result);
    }

    pub async fn send(&self, conversation_id: &str, user_content: &str) -> Result<(), String> {
        let messages = self
            .build_message_list(conversation_id, Some(user_content), None)
            .await?;
        append_message(
            &self.state,
            conversation_id,
            "user",
            user_content,
            Some(AppendMessageMeta {
                timestamp: Some(chrono::Utc::now().timestamp_millis()),
                tool_calls: None,
                model: None,
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
        self.stream_assistant_reply(conversation_id, messages).await
    }

    pub async fn polish_last_user(&self, conversation_id: &str) -> Result<(), String> {
        let transcript = pop_last_user_message(&self.state, conversation_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No user message to polish.".to_string())?;
        let instruction = DICTATION_POLISH_INSTRUCTION;
        let t1 = chrono::Utc::now().timestamp_millis();
        let t2 = t1 + 1;
        let messages = self
            .build_message_list(conversation_id, Some(instruction), Some(&transcript))
            .await?;
        append_message(
            &self.state,
            conversation_id,
            "user",
            instruction,
            Some(AppendMessageMeta {
                timestamp: Some(t1),
                tool_calls: None,
                model: None,
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
        append_message(
            &self.state,
            conversation_id,
            "user",
            &transcript,
            Some(AppendMessageMeta {
                timestamp: Some(t2),
                tool_calls: None,
                model: None,
            }),
        )
        .await
        .map_err(|e| e.to_string())?;
        self.stream_assistant_reply(conversation_id, messages).await
    }

    pub async fn generate_reply(&self, conversation_id: &str) -> Result<(), String> {
        let messages = self.build_message_list(conversation_id, None, None).await?;
        self.stream_assistant_reply(conversation_id, messages).await
    }

    pub async fn get_system_prompt_preview(
        &self,
        platform: &str,
    ) -> Result<SystemPromptPreview, String> {
        let platform = if platform == "ios" { "ios" } else { "desktop" };
        let settings = settings::get_settings(&self.state.write_chains).await;
        let strategy = parse_memory_injection_strategy(
            settings
                .get("memory")
                .and_then(|v| v.get("injectionStrategy")),
        );
        let user_memory = get_user_memory(&self.state)
            .await
            .map_err(|e| e.to_string())?;
        let selected_memory =
            select_memory_entries_for_prompt(strategy, &user_memory, None);
        let memory_block = format_memory_context_block(&selected_memory);
        let temporal_context = format_temporal_context_block();
        let fields = fields_from_settings(&settings);
        let static_prompt = crate::system_prompt::build_static_system_prompt(&fields, platform);
        let assembled_prompt =
            build_system_prompt(&fields, platform, &memory_block, &temporal_context);
        Ok(SystemPromptPreview {
            platform: platform.to_string(),
            static_prompt,
            memory_block,
            temporal_context,
            assembled_prompt,
            injection_strategy: strategy.to_string(),
            selected_facts: selected_memory
                .into_iter()
                .map(|(key, value)| SystemPromptPreviewFact { key, value })
                .collect(),
        })
    }

    async fn build_message_list(
        &self,
        conversation_id: &str,
        user_content: Option<&str>,
        second_user_content: Option<&str>,
    ) -> Result<Vec<ChatMessageParam>, String> {
        let settings = settings::get_settings(&self.state.write_chains).await;
        let strategy = parse_memory_injection_strategy(
            settings
                .get("memory")
                .and_then(|v| v.get("injectionStrategy")),
        );
        let user_memory = get_user_memory(&self.state)
            .await
            .map_err(|e| e.to_string())?;
        let scoring_content = user_content.or(second_user_content);
        let selected_memory =
            select_memory_entries_for_prompt(strategy, &user_memory, scoring_content);
        let memory_block = format_memory_context_block(&selected_memory);
        let temporal_context = format_temporal_context_block();
        let fields = fields_from_settings(&settings);
        let system_prompt = build_system_prompt(
            &fields,
            "desktop",
            &memory_block,
            &temporal_context,
        );

        let history = get_messages(&self.state, conversation_id)
            .await
            .map_err(|e| e.to_string())?;
        let mut messages = vec![ChatMessageParam {
            role: "system".into(),
            content: Some(system_prompt),
            tool_calls: None,
            tool_call_id: None,
        }];
        let now_ms = chrono::Utc::now().timestamp_millis();
        for m in history {
            if m.role == "system" {
                messages.push(ChatMessageParam {
                    role: m.role,
                    content: Some(m.content),
                    tool_calls: None,
                    tool_call_id: None,
                });
                continue;
            }
            messages.push(ChatMessageParam {
                role: m.role.clone(),
                content: Some(annotate_message_content_for_model(
                    &m.content,
                    m.timestamp,
                )),
                tool_calls: None,
                tool_call_id: None,
            });
        }
        if let Some(content) = user_content {
            messages.push(ChatMessageParam {
                role: "user".into(),
                content: Some(annotate_message_content_for_model(content, Some(now_ms))),
                tool_calls: None,
                tool_call_id: None,
            });
        }
        if let Some(content) = second_user_content {
            messages.push(ChatMessageParam {
                role: "user".into(),
                content: Some(annotate_message_content_for_model(content, Some(now_ms + 1))),
                tool_calls: None,
                tool_call_id: None,
            });
        }
        Ok(messages)
    }

    async fn execute_tool(
        &self,
        name: &str,
        args: Value,
        conversation_id: &str,
    ) -> Result<String, String> {
        let gated = matches!(name, "task_delete" | "task_clear_completed" | "task_update");
        let mut skip_tool_panel_update = should_skip_note_stream_tool_panel(name, &args);

        let result = if is_customization_tool_name(name) {
            execute_customization_tool(name, &args)
        } else if is_assistant_tool_name(name) {
            if gated {
                let pending_id = Uuid::new_v4().to_string();
                let pending_payload = json!({
                    "pending": true,
                    "tool": name,
                    "args": args,
                    "pendingId": pending_id
                });
                self.emit_tool_panel_update(conversation_id, name, pending_payload);

                let (tx, rx) = oneshot::channel();
                self.pending_gated.lock().await.insert(
                    pending_id,
                    PendingGatedTool {
                        tool: name.to_string(),
                        args,
                        respond_to: tx,
                    },
                );
                skip_tool_panel_update = true;
                rx.await.unwrap_or_else(|_| {
                    json!({ "error": "Gated tool request was cancelled." }).to_string()
                })
            } else {
                execute_assistant_tool(&self.state, name, args)
                    .await
                    .map_err(|e| e.to_string())?
            }
        } else {
            execute_file_tool(name, &args)
        };

        if is_assistant_tool_name(name) && !skip_tool_panel_update {
            let payload = serde_json::from_str::<Value>(&result).unwrap_or_else(|_| json!(result));
            self.emit_tool_panel_update(conversation_id, name, payload);
        }

        if name == "note_create" {
            if let Ok(payload) = serde_json::from_str::<Value>(&result) {
                activate_note_stream_from_payload(self, conversation_id, &payload);
            }
        }

        Ok(result)
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
        self.emit_stream_end(conversation_id);

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

        {
            let mut guard = self.cancel_token.lock().await;
            *guard = None;
        }
        Ok(())
    }

    async fn stream_assistant_reply(
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
                            let result = controller
                                .execute_tool(&name, args, &conversation_id)
                                .await
                                .map_err(OpenAIError::Api)?;
                            if is_assistant_tool_name(&name) {
                                let payload = serde_json::from_str::<Value>(&result)
                                    .unwrap_or_else(|_| json!(result));
                                tool_calls_cb.lock().await.push(ToolCallRecord {
                                    tool_name: name,
                                    payload: Some(payload),
                                });
                            }
                            Ok(result)
                        }
                    }
                },
                &cancel,
            )
            .await;

        self.emit_stream_end(conversation_id);

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
                if !is_abort {
                    {
                        let mut guard = self.cancel_token.lock().await;
                        *guard = None;
                    }
                    return Err(err.to_string());
                }
            }
        }

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
}

fn should_skip_note_stream_tool_panel(name: &str, args: &Value) -> bool {
    if name != "note_create" {
        return false;
    }
    let summary = args
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if summary.is_empty() {
        return false;
    }
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    content.is_empty()
}

fn activate_note_stream_from_payload(
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

fn note_summary_metadata(note: &notes::Note) -> Value {
    json!({
        "id": note.id,
        "title": note.title,
        "createdAt": note.created_at,
        "updatedAt": note.updated_at,
        "wordCount": note.word_count,
    })
}

fn finalize_tool_calls_with_note_stream(
    mut tool_calls: Vec<ToolCallRecord>,
    stream: &NoteStreamState,
    saved_note: &notes::Note,
) -> Vec<ToolCallRecord> {
    let mut found = false;
    for tc in &mut tool_calls {
        if tc.tool_name == "note_create" {
            if let Some(payload) = tc.payload.as_mut() {
                if let Some(obj) = payload.as_object_mut() {
                    obj.insert("note".into(), note_summary_metadata(saved_note));
                    obj.insert("attachedToMessage".into(), json!(true));
                    obj.insert("summary".into(), json!(stream.summary));
                }
            }
            found = true;
            break;
        }
    }
    if !found {
        tool_calls.push(ToolCallRecord {
            tool_name: "note_create".into(),
            payload: Some(json!({
                "note": note_summary_metadata(saved_note),
                "attachedToMessage": true,
                "summary": stream.summary,
            })),
        });
    }
    tool_calls
}

fn finalize_tool_calls_with_note_stream_metadata(
    mut tool_calls: Vec<ToolCallRecord>,
    stream: &NoteStreamState,
) -> Vec<ToolCallRecord> {
    let mut found = false;
    for tc in &mut tool_calls {
        if tc.tool_name == "note_create" {
            if let Some(payload) = tc.payload.as_mut() {
                if let Some(obj) = payload.as_object_mut() {
                    if let Some(note) = obj.get_mut("note") {
                        if let Some(note_obj) = note.as_object_mut() {
                            note_obj.remove("content");
                        }
                    }
                    obj.insert("attachedToMessage".into(), json!(true));
                    obj.insert("summary".into(), json!(stream.summary));
                }
            }
            found = true;
            break;
        }
    }
    if !found {
        tool_calls.push(ToolCallRecord {
            tool_name: "note_create".into(),
            payload: Some(json!({
                "note": {
                    "id": stream.note_id,
                    "title": stream.title,
                },
                "attachedToMessage": true,
                "summary": stream.summary,
            })),
        });
    }
    tool_calls
}

fn strip_note_content_from_tool_calls(mut tool_calls: Vec<ToolCallRecord>) -> Vec<ToolCallRecord> {
    for tc in &mut tool_calls {
        if tc.tool_name != "note_create" {
            continue;
        }
        let Some(payload) = tc.payload.as_mut() else {
            continue;
        };
        let Some(obj) = payload.as_object_mut() else {
            continue;
        };
        if obj.get("attachedToMessage").and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }
        if let Some(note) = obj.get_mut("note") {
            if let Some(note_obj) = note.as_object_mut() {
                note_obj.remove("content");
            }
        }
    }
    tool_calls
}

fn message_content_for_turn(
    stream_state: Option<&NoteStreamState>,
    tool_calls: &[ToolCallRecord],
    stream_content: &str,
) -> String {
    if let Some(stream) = stream_state {
        return stream.summary.clone();
    }
    for tc in tool_calls {
        if tc.tool_name != "note_create" {
            continue;
        }
        let Some(payload) = &tc.payload else {
            continue;
        };
        if payload.get("attachedToMessage").and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }
        if let Some(summary) = payload.get("summary").and_then(|v| v.as_str()) {
            if !summary.trim().is_empty() {
                return summary.to_string();
            }
        }
    }
    strip_sent_at_prefix(stream_content)
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

fn format_temporal_context_block() -> String {
    let tz = iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into());
    let now = chrono::Local::now();
    let formatted = now.format("%A, %B %d, %Y at %I:%M:%S %p %Z").to_string();
    format!(
        "[TEMPORAL_CONTEXT]\nCurrent local date and time ({tz}): {formatted}\nWhen present, a user message begins with [sent_at=...] (ISO 8601 UTC) for when it was sent.\nUse sent_at together with the current time above to interpret relative dates and whether discussed future plans, events, or deadlines have already passed.\nNever include [sent_at=...] in your replies; it is metadata on user messages only."
    )
}

fn annotate_message_content_for_model(content: &str, timestamp_ms: Option<i64>) -> String {
    let Some(ts) = timestamp_ms else {
        return content.to_string();
    };
    let re = Regex::new(r"^\[sent_at=[^\]]+\]\n").unwrap();
    if re.is_match(content) {
        return content.to_string();
    }
    let sent_at = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ts)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();
    format!("[sent_at={sent_at}]\n{content}")
}

fn strip_sent_at_prefix(content: &str) -> String {
    let re = Regex::new(r"\[sent_at=[^\]]+\]\n?").unwrap();
    re.replace_all(content, "").into_owned()
}

type MemoryStrategy = &'static str;

fn parse_memory_injection_strategy(raw: Option<&Value>) -> MemoryStrategy {
    match raw.and_then(|v| v.as_str()) {
        Some("all") => "all",
        Some("relevant") => "relevant",
        Some("budget") => "budget",
        Some("none") => "none",
        _ => "all",
    }
}

fn to_tokens(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .filter(|t| t.len() >= 3 && !MEMORY_STOPWORDS.contains(&t))
        .map(str::to_string)
        .collect()
}

fn count_overlap(base: &HashSet<String>, candidates: &[String]) -> usize {
    candidates.iter().filter(|t| base.contains(*t)).count()
}

fn score_memory_entry(key: &str, value: &str, user_content: &str) -> f64 {
    let user_tokens: HashSet<String> = to_tokens(user_content).into_iter().collect();
    if user_tokens.is_empty() {
        return 0.0;
    }
    let key_tokens = to_tokens(key);
    let value_tokens = to_tokens(value);
    let key_matches = count_overlap(&user_tokens, &key_tokens);
    let value_matches = count_overlap(&user_tokens, &value_tokens);
    let token_norm = ((key_tokens.len() + value_tokens.len()) as f64).sqrt().max(1.0);
    let mut score = (key_matches as f64 * 2.0 + value_matches as f64) / token_norm;
    let key_lower = key.to_lowercase();
    if MEMORY_ALWAYS_RELEVANT_KEY_PARTS
        .iter()
        .any(|part| key_lower.contains(part))
    {
        score += 1.0;
    }
    let extra_chars = value.len().saturating_sub(260);
    score -= (extra_chars as f64 / 200.0) * 0.2;
    score
}

fn sorted_memory_entries(user_memory: &HashMap<String, String>) -> Vec<(String, String)> {
    let mut entries: Vec<(String, String)> = user_memory
        .iter()
        .filter(|(k, _)| !k.trim().is_empty())
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    entries
}

fn apply_char_budget(rows: &[(String, String)], max_chars: usize) -> Vec<(String, String)> {
    let mut used_chars = 0usize;
    let mut selected = Vec::new();
    for (key, value) in rows {
        let next_line = format!("- {key}: {value}");
        if !selected.is_empty() && used_chars + next_line.len() > max_chars {
            break;
        }
        selected.push((key.clone(), value.clone()));
        used_chars += next_line.len();
    }
    selected
}

fn select_relevant_entries(
    entries: &[(String, String)],
    user_content: Option<&str>,
) -> Vec<(String, String)> {
    let Some(content) = user_content.map(str::trim).filter(|s| !s.is_empty()) else {
        return entries
            .iter()
            .take(RELEVANT_FALLBACK_COUNT)
            .cloned()
            .collect();
    };

    let mut scored: Vec<(String, String, f64)> = entries
        .iter()
        .map(|(key, value)| {
            (
                key.clone(),
                value.clone(),
                score_memory_entry(key, value, content),
            )
        })
        .filter(|(_, _, score)| *score >= RELEVANT_MIN_SCORE)
        .collect();
    scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(RELEVANT_MAX_ENTRIES);
    let rows: Vec<(String, String)> = scored
        .into_iter()
        .map(|(k, v, _)| (k, v))
        .collect();
    apply_char_budget(&rows, RELEVANT_MAX_CHARS)
}

fn select_budget_entries(entries: &[(String, String)]) -> Vec<(String, String)> {
    apply_char_budget(entries, BUDGET_MAX_CHARS)
}

fn select_memory_entries_for_prompt(
    strategy: MemoryStrategy,
    user_memory: &HashMap<String, String>,
    user_content: Option<&str>,
) -> Vec<(String, String)> {
    if strategy == "none" {
        return Vec::new();
    }
    let entries = sorted_memory_entries(user_memory);
    if entries.is_empty() {
        return Vec::new();
    }
    match strategy {
        "all" => entries,
        "relevant" => select_relevant_entries(&entries, user_content),
        "budget" => select_budget_entries(&entries),
        _ => entries,
    }
}

fn format_memory_context_block(selected: &[(String, String)]) -> String {
    if selected.is_empty() {
        return String::new();
    }
    let mut lines = vec![
        "[USER_MEMORY_CONTEXT]".to_string(),
        "Use only if relevant to the current request.".to_string(),
    ];
    for (k, v) in selected {
        lines.push(format!("- {k}: {v}"));
    }
    lines.push(String::new());
    lines.push("[MEMORY_RULES]".into());
    lines.push("- Treat memory as hints, not absolute truth.".into());
    lines.push("- If memory conflicts with the user's current message, follow the current message.".into());
    lines.push("- If uncertain whether memory still applies, ask one brief clarifying question.".into());
    lines.join("\n")
}
