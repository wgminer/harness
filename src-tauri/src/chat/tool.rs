use serde_json::{json, Value};
use tokio::sync::oneshot;
use uuid::Uuid;

use crate::assistant_tools::{execute_assistant_tool, is_assistant_tool_name};
use crate::customization::{execute_customization_tool, is_customization_tool_name};
use crate::file_tools::execute_file_tool;

use super::stream::{activate_note_stream_from_payload, NoteStreamState};
use super::ChatController;

pub(crate) struct PendingGatedTool {
    tool: String,
    args: Value,
    respond_to: oneshot::Sender<String>,
}

impl ChatController {
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

    pub(crate) async fn execute_tool(
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
