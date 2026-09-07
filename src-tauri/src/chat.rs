use std::collections::HashMap;
use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::memory::AppState;

mod gated_checkpoint;
mod stream;
mod tool;
mod turn;

pub use turn::{
    ContextPreview, ContextPreviewMemory, ContextPreviewMessage, ContextPreviewTool,
};

use stream::NoteStreamState;
use tool::PendingGatedTool;

#[derive(Clone)]
pub struct ChatController {
    pub(crate) app: AppHandle,
    pub(crate) state: AppState,
    pub(crate) cancel_token: Arc<Mutex<Option<CancellationToken>>>,
    pub(crate) pending_gated: Arc<Mutex<HashMap<String, PendingGatedTool>>>,
    pub(crate) note_stream: Arc<std::sync::Mutex<Option<NoteStreamState>>>,
    /// Conversation id for the in-flight assistant stream, if any.
    pub(crate) active_stream_conversation: Arc<Mutex<Option<String>>>,
    /// UI-visible assistant text accumulated for the active stream (for remount rehydrate).
    pub(crate) active_stream_content: Arc<Mutex<String>>,
}

impl ChatController {
    pub fn new(app: AppHandle, state: AppState) -> Self {
        Self {
            app,
            state,
            cancel_token: Arc::new(Mutex::new(None)),
            pending_gated: Arc::new(Mutex::new(HashMap::new())),
            note_stream: Arc::new(std::sync::Mutex::new(None)),
            active_stream_conversation: Arc::new(Mutex::new(None)),
            active_stream_content: Arc::new(Mutex::new(String::new())),
        }
    }
}
