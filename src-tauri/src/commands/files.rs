//! Plain text files edited in place (`harness <path>`, Finder "Open With").

use serde_json::Value;
use tauri::{command, AppHandle, State};

use crate::files::{
    import_file_as_note, install_cli, open_file_window, read_text_file, save_text_file,
    stat_text_file, CliInstallResult, TextFile,
};
use crate::state::AppState;

use super::map_err;

#[command(rename_all = "camelCase")]
pub async fn files_read_text(path: String) -> Result<TextFile, String> {
    read_text_file(&path).await
}

#[command(rename_all = "camelCase")]
pub async fn files_stat(path: String) -> Result<Option<i64>, String> {
    stat_text_file(&path).await
}

#[command(rename_all = "camelCase")]
pub async fn files_save_text(
    state: State<'_, AppState>,
    path: String,
    content: String,
    expected_modified_ms: Option<i64>,
) -> Result<i64, String> {
    save_text_file(&state, &path, &content, expected_modified_ms).await
}

#[command(rename_all = "camelCase")]
pub async fn files_import_as_note(
    state: State<'_, AppState>,
    path: String,
) -> Result<Value, String> {
    let note = import_file_as_note(&state, &path).await?;
    serde_json::to_value(note).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn files_open_window(app: AppHandle, path: String) -> Result<(), String> {
    let resolved = std::path::PathBuf::from(path.trim());
    if !resolved.is_absolute() {
        return Err("Expected an absolute path.".into());
    }
    open_file_window(&app, &resolved)
}

#[command(rename_all = "camelCase")]
pub async fn files_install_cli() -> Result<CliInstallResult, String> {
    install_cli()
}
