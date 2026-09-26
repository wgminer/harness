//! Notes and sticky note windows.

use serde_json::Value;
use tauri::{command, AppHandle, State};

use crate::notes::sticky::{
    open_sticky_window, pop_in_sticky, set_sticky_pinned, set_sticky_title, StickyWindowEntry,
};
use crate::notes::{
    create_note, delete_note, list_notes, propose_note_edit, propose_note_spell_check, read_note,
    save_note, show_note_in_folder,
};
use crate::state::AppState;

use super::map_err;

#[command(rename_all = "camelCase")]
pub async fn notes_list(state: State<'_, AppState>) -> Result<Value, String> {
    let notes = list_notes(&state).await.map_err(map_err)?;
    serde_json::to_value(notes).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_create(
    state: State<'_, AppState>,
    title: Option<String>,
    content: Option<String>,
) -> Result<Value, String> {
    let note = create_note(&state, title.as_deref(), content.as_deref().unwrap_or(""))
        .await
        .map_err(map_err)?;
    serde_json::to_value(note).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_read(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let note = read_note(&state, &id).await.map_err(map_err)?;
    serde_json::to_value(note).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_save(
    state: State<'_, AppState>,
    id: String,
    content: String,
) -> Result<Value, String> {
    let note = save_note(&state, &id, &content).await.map_err(map_err)?;
    serde_json::to_value(note).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_delete(state: State<'_, AppState>, id: String) -> Result<Value, String> {
    let list = delete_note(&state, &id).await.map_err(map_err)?;
    serde_json::to_value(list).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_show_in_folder(id: String) -> Result<(), String> {
    show_note_in_folder(&id).await.map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_propose_edit(input: Value) -> Result<Value, String> {
    let proposal = propose_note_edit(&input).await.map_err(map_err)?;
    serde_json::to_value(proposal).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_spell_check(input: Value) -> Result<Value, String> {
    let proposal = propose_note_spell_check(&input).await.map_err(map_err)?;
    serde_json::to_value(proposal).map_err(map_err)
}

#[command(rename_all = "camelCase")]
pub async fn notes_open_sticky(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: String,
) -> Result<StickyWindowEntry, String> {
    open_sticky_window(&app, &state, &note_id, None).await
}

#[command(rename_all = "camelCase")]
pub async fn notes_set_sticky_pinned(
    app: AppHandle,
    note_id: String,
    pinned: bool,
) -> Result<(), String> {
    set_sticky_pinned(&app, &note_id, pinned)
}

#[command(rename_all = "camelCase")]
pub async fn notes_set_sticky_title(
    app: AppHandle,
    note_id: String,
    title: String,
) -> Result<(), String> {
    set_sticky_title(&app, &note_id, &title)
}

#[command(rename_all = "camelCase")]
pub async fn notes_pop_in_sticky(app: AppHandle, note_id: String) -> Result<(), String> {
    pop_in_sticky(&app, &note_id)
}
