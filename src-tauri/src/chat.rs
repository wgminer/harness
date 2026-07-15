use std::collections::HashMap;
use std::sync::Arc;

use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use crate::memory::AppState;

mod stream;
mod tool;
mod turn;

pub use turn::{
    ContextPreview, ContextPreviewFact, ContextPreviewMessage, ContextPreviewTool,
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
}
