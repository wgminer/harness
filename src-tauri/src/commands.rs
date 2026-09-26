//! Tauri command handlers wiring renderer IPC to backend modules, split by domain.

pub mod app;
pub mod chat;
pub mod coding;
pub mod credentials;
pub mod images;
pub mod memory;
pub mod notes;
pub mod settings;
pub mod tasks;
pub mod ui;

pub(crate) fn map_err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}
