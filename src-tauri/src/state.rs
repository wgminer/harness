//! Process-wide state shared by every Tauri command and background runtime.

use crate::storage::{new_write_chains, WriteChains};

#[derive(Clone)]
pub struct AppState {
    pub write_chains: WriteChains,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            write_chains: new_write_chains(),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
