//! Durable gated-tool checkpoints so approval can survive app restart.
//!
//! While a mutating tool waits for Proceed/Cancel, we persist enough of the
//! OpenAI tool round to continue after process death (messages, tool_call_id,
//! remaining calls in the batch, content so far).

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::memory::ToolCallRecord;
use crate::openai::{ChatMessageParam, ToolCallParam};
use crate::paths::get_app_state_dir;

const CHECKPOINT_DIR: &str = "gated-tool-checkpoints";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatedCheckpoint {
    pub conversation_id: String,
    pub pending_id: String,
    pub tool: String,
    pub args: Value,
    pub preview_payload: Value,
    pub tool_call_id: String,
    /// Messages including the assistant `tool_calls` message and any tool
    /// results already produced earlier in this batch.
    pub messages: Vec<ChatMessageParam>,
    pub remaining_tool_calls: Vec<ToolCallParam>,
    pub content_so_far: String,
    pub tool_records_so_far: Vec<ToolCallRecord>,
}

fn checkpoint_dir() -> PathBuf {
    let dir = get_app_state_dir().join(CHECKPOINT_DIR);
    let _ = fs::create_dir_all(&dir);
    dir
}

fn checkpoint_path(pending_id: &str) -> PathBuf {
    // pending ids are UUIDs; sanitize just in case
    let safe: String = pending_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' })
        .collect();
    checkpoint_dir().join(format!("{safe}.json"))
}

pub fn save_checkpoint(checkpoint: &GatedCheckpoint) -> Result<(), String> {
    let path = checkpoint_path(&checkpoint.pending_id);
    let json = serde_json::to_vec_pretty(checkpoint).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

pub fn load_checkpoint(pending_id: &str) -> Option<GatedCheckpoint> {
    let path = checkpoint_path(pending_id);
    let bytes = fs::read(&path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn clear_checkpoint(pending_id: &str) {
    let path = checkpoint_path(pending_id);
    let _ = fs::remove_file(path);
}

pub fn load_all_checkpoints() -> Vec<GatedCheckpoint> {
    let dir = checkpoint_dir();
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(cp) = serde_json::from_slice::<GatedCheckpoint>(&bytes) {
                out.push(cp);
            }
        }
    }
    out
}

pub fn clear_all_checkpoints() {
    for cp in load_all_checkpoints() {
        clear_checkpoint(&cp.pending_id);
    }
}
