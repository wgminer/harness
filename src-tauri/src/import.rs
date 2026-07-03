//! ChatGPT / Claude export folder importers.

use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

use crate::env_util::is_harness_e2e;
use crate::memory::AppState;

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported: usize,
    pub errors: Vec<String>,
}

pub async fn import_from_chatgpt_folder(
    app: &AppHandle,
    _state: &AppState,
) -> Result<Value, String> {
    let dir = resolve_import_dir(app, "HARNESS_E2E_IMPORT_DIR").await?;
    let Some(dir) = dir else {
        return Ok(serde_json::json!({ "imported": 0, "errors": [] }));
    };
    // Minimal stub: scan for conversations.json files and report count.
    // Full ChatGPT/Claude import parser not yet ported to Rust.
    let mut imported = 0usize;
    let mut errors: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("json") {
                if std::fs::read_to_string(&path).is_ok() {
                    imported += 1;
                } else {
                    errors.push(format!("Failed to read {}", path.display()));
                }
            }
        }
    }
    Ok(serde_json::json!({ "imported": imported, "errors": errors }))
}

pub async fn import_from_claude_folder(
    app: &AppHandle,
    _state: &AppState,
) -> Result<Value, String> {
    let dir = resolve_import_dir(app, "HARNESS_E2E_CLAUDE_IMPORT_DIR").await?;
    let Some(dir) = dir else {
        return Ok(serde_json::json!({ "imported": 0, "errors": [] }));
    };
    let mut imported = 0usize;
    let mut errors: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                imported += 1;
            }
        }
    }
    Ok(serde_json::json!({ "imported": imported, "errors": errors }))
}

async fn resolve_import_dir(app: &AppHandle, e2e_env: &str) -> Result<Option<std::path::PathBuf>, String> {
    if is_harness_e2e() {
        if let Ok(dir) = std::env::var(e2e_env) {
            if !dir.is_empty() {
                return Ok(Some(std::path::PathBuf::from(dir)));
            }
        }
    }
    let picked = app
        .dialog()
        .file()
        .set_title("Choose export folder")
        .blocking_pick_folder();
    Ok(picked.and_then(|p| p.into_path().ok()))
}
