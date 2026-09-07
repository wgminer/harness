use serde_json::{json, Value};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::assistant_tools::{execute_assistant_tool, is_assistant_tool_name};
use crate::coding::{
    coding_gated_preview, coding_tool_is_gated, coding_tool_name_is, execute_coding_tool,
    scope_from_meta,
};
use crate::customization::{execute_customization_tool, is_customization_tool_name};
use crate::memory::{get_conversation_coding_scope, ToolCallRecord};
use crate::openai::{ChatMessageParam, ToolCallParam};

use super::gated_checkpoint::{
    clear_all_checkpoints, clear_checkpoint, load_checkpoint, save_checkpoint, GatedCheckpoint,
};
use super::stream::{activate_note_stream_from_payload, NoteStreamState};
use super::ChatController;

pub(crate) struct PendingGatedTool {
    pub(crate) tool: String,
    args: Value,
    pub(crate) conversation_id: String,
    /// Payload last shown in the tool panel (includes pendingId / preview).
    pub(crate) preview_payload: Value,
    respond_to: oneshot::Sender<String>,
}

/// Snapshot of the OpenAI tool round, captured when a gated tool starts waiting.
pub(crate) struct GatedTurnSnapshot {
    pub tool_call_id: String,
    pub messages: Vec<ChatMessageParam>,
    pub remaining_tool_calls: Vec<ToolCallParam>,
    pub content_so_far: String,
    pub tool_records_so_far: Vec<ToolCallRecord>,
}

impl ChatController {
    pub async fn cancel_all_gated_tools(&self, message: &str) {
        let pending: Vec<_> = {
            let mut map = self.pending_gated.lock().await;
            map.drain().map(|(_, pending)| pending).collect()
        };
        let result = json!({
            "cancelled": true,
            "stopped": true,
            "message": message
        })
        .to_string();
        for pending in pending {
            let _ = pending.respond_to.send(result.clone());
        }
        // Orphaned disk checkpoints (e.g. after restart) — clear and notify UI.
        for cp in super::gated_checkpoint::load_all_checkpoints() {
            let mut payload = cp.preview_payload.clone();
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("pending".into(), json!(false));
                obj.insert("cancelled".into(), json!(true));
                obj.insert("stopped".into(), json!(true));
                obj.insert("message".into(), json!(message));
            }
            self.emit_tool_panel_update(&cp.conversation_id, &cp.tool, payload);
            clear_checkpoint(&cp.pending_id);
        }
        clear_all_checkpoints();
    }

    pub async fn resolve_gated_tool(&self, pending_id: &str, action: &str) {
        let pending = {
            let mut map = self.pending_gated.lock().await;
            map.remove(pending_id)
        };
        if let Some(pending) = pending {
            let result = run_gated_action(
                &self.state,
                &pending.conversation_id,
                &pending.tool,
                pending.args,
                action,
            )
            .await;
            let _ = pending
                .respond_to
                .send(with_pending_id(&result, pending_id));
            return;
        }

        // Process restarted — resume from durable checkpoint.
        let Some(checkpoint) = load_checkpoint(pending_id) else {
            return;
        };
        let controller = self.clone();
        let action = action.to_string();
        tauri::async_runtime::spawn(async move {
            if let Err(err) = controller
                .resume_from_gated_checkpoint(checkpoint, &action)
                .await
            {
                eprintln!("[harness] gated tool resume failed: {err}");
            }
        });
    }

    pub(crate) async fn execute_tool(
        &self,
        name: &str,
        args: Value,
        conversation_id: &str,
        snapshot: Option<GatedTurnSnapshot>,
    ) -> Result<String, String> {
        let gated_task = matches!(name, "task_delete" | "task_clear_completed" | "task_update");
        let skip_tool_panel_update = should_skip_note_stream_tool_panel(name, &args);

        let result = if is_customization_tool_name(name) {
            execute_customization_tool(name, &args)
        } else if coding_tool_name_is(name) {
            let scope = load_scope_for_conversation(&self.state, conversation_id).await?;
            if coding_tool_is_gated(name, &args) {
                let pending_id = Uuid::new_v4().to_string();
                let mut pending_payload = coding_gated_preview(&scope, name, &args);
                if let Some(obj) = pending_payload.as_object_mut() {
                    obj.insert("pendingId".into(), json!(pending_id));
                    obj.insert("pending".into(), json!(true));
                    obj.insert("tool".into(), json!(name));
                }
                self.await_gated_approval(
                    conversation_id,
                    name,
                    args,
                    pending_payload,
                    &pending_id,
                    snapshot,
                )
                .await
            } else {
                execute_coding_tool(&scope, name, args).await
            }
        } else if is_assistant_tool_name(name) {
            if gated_task {
                let pending_id = Uuid::new_v4().to_string();
                let pending_payload = json!({
                    "pending": true,
                    "tool": name,
                    "args": args,
                    "pendingId": pending_id
                });
                self.await_gated_approval(
                    conversation_id,
                    name,
                    args,
                    pending_payload,
                    &pending_id,
                    snapshot,
                )
                .await
            } else {
                execute_assistant_tool(&self.state, name, args, Some(conversation_id))
                    .await
                    .map_err(|e| e.to_string())?
            }
        } else {
            json!({ "error": format!("Unknown tool: {name}") }).to_string()
        };

        if (is_assistant_tool_name(name) || coding_tool_name_is(name)) && !skip_tool_panel_update {
            let mut payload =
                serde_json::from_str::<Value>(&result).unwrap_or_else(|_| json!(result));
            if let Some(obj) = payload.as_object_mut() {
                obj.insert("pending".into(), json!(false));
            }
            self.emit_tool_panel_update(conversation_id, name, payload);
        }

        if name == "note_create" {
            if let Ok(payload) = serde_json::from_str::<Value>(&result) {
                activate_note_stream_from_payload(self, conversation_id, &payload);
            }
        }

        Ok(result)
    }

    async fn await_gated_approval(
        &self,
        conversation_id: &str,
        name: &str,
        args: Value,
        pending_payload: Value,
        pending_id: &str,
        snapshot: Option<GatedTurnSnapshot>,
    ) -> String {
        self.emit_tool_panel_update(conversation_id, name, pending_payload.clone());

        if let Some(snap) = snapshot {
            let checkpoint = GatedCheckpoint {
                conversation_id: conversation_id.to_string(),
                pending_id: pending_id.to_string(),
                tool: name.to_string(),
                args: args.clone(),
                preview_payload: pending_payload.clone(),
                tool_call_id: snap.tool_call_id,
                messages: snap.messages,
                remaining_tool_calls: snap.remaining_tool_calls,
                content_so_far: snap.content_so_far,
                tool_records_so_far: snap.tool_records_so_far,
            };
            if let Err(err) = save_checkpoint(&checkpoint) {
                eprintln!("[harness] failed to save gated checkpoint: {err}");
            }
        }

        let (tx, rx) = oneshot::channel();
        self.pending_gated.lock().await.insert(
            pending_id.to_string(),
            PendingGatedTool {
                tool: name.to_string(),
                args,
                conversation_id: conversation_id.to_string(),
                preview_payload: pending_payload,
                respond_to: tx,
            },
        );

        let result = with_pending_id(
            &rx.await.unwrap_or_else(|_| {
                json!({
                    "cancelled": true,
                    "stopped": true,
                    "message": "Stopped while waiting for approval — the pending action was not run."
                })
                .to_string()
            }),
            pending_id,
        );
        clear_checkpoint(pending_id);
        result
    }
}

async fn run_gated_action(
    state: &crate::memory::AppState,
    conversation_id: &str,
    tool: &str,
    args: Value,
    action: &str,
) -> String {
    if action == "proceed" {
        if coding_tool_name_is(tool) {
            match load_scope_for_conversation(state, conversation_id).await {
                Ok(scope) => execute_coding_tool(&scope, tool, args).await,
                Err(e) => json!({ "error": e }).to_string(),
            }
        } else {
            execute_assistant_tool(state, tool, args, None)
                .await
                .unwrap_or_else(|e| json!({ "error": e.to_string() }).to_string())
        }
    } else {
        json!({ "cancelled": true, "message": "User cancelled the action." }).to_string()
    }
}

fn with_pending_id(result: &str, pending_id: &str) -> String {
    let mut payload = serde_json::from_str::<Value>(result).unwrap_or_else(|_| json!(result));
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("pendingId".into(), json!(pending_id));
        obj.insert("pending".into(), json!(false));
        return payload.to_string();
    }
    json!({
        "result": result,
        "pendingId": pending_id,
        "pending": false
    })
    .to_string()
}

async fn load_scope_for_conversation(
    state: &crate::memory::AppState,
    conversation_id: &str,
) -> Result<crate::coding::scope::CodingScope, String> {
    let meta = get_conversation_coding_scope(state, conversation_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No coding scope set for this conversation. Choose a project folder or Harness UI first."
                .to_string()
        })?;
    scope_from_meta(&meta)
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

pub(crate) fn finalize_tool_calls_with_note_stream(
    mut tool_calls: Vec<crate::memory::ToolCallRecord>,
    stream: &NoteStreamState,
    saved_note: &crate::notes::Note,
) -> Vec<crate::memory::ToolCallRecord> {
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
        tool_calls.push(crate::memory::ToolCallRecord {
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

pub(crate) fn finalize_tool_calls_with_note_stream_metadata(
    mut tool_calls: Vec<crate::memory::ToolCallRecord>,
    stream: &NoteStreamState,
) -> Vec<crate::memory::ToolCallRecord> {
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
        tool_calls.push(crate::memory::ToolCallRecord {
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

pub(crate) fn strip_note_content_from_tool_calls(
    mut tool_calls: Vec<crate::memory::ToolCallRecord>,
) -> Vec<crate::memory::ToolCallRecord> {
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

pub(crate) fn message_content_for_turn(
    stream_state: Option<&NoteStreamState>,
    tool_calls: &[crate::memory::ToolCallRecord],
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
    super::turn::strip_sent_at_prefix(stream_content)
}

fn note_summary_metadata(note: &crate::notes::Note) -> Value {
    json!({
        "id": note.id,
        "title": note.title,
        "createdAt": note.created_at,
        "updatedAt": note.updated_at,
        "wordCount": note.word_count,
    })
}
