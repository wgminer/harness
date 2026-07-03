use std::path::{Path, PathBuf};

use chrono::Local;
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::memory::AppState;
use crate::paths::get_app_state_dir;
use crate::storage::{atomic_write_utf8, file_exists};

const LEGACY_DOC_FILE: &str = "writing.md";
const NOTES_INDEX_FILE: &str = "notes.json";
const NOTES_DIR: &str = "notes";
const LEGACY_IMPORTED_NOTE_TITLE: &str = "Imported note";
const UNTITLED_NOTE_TITLE: &str = "Untitled";
const NOTE_TEMPLATE_TODAY_TOKEN: &str = "{{today}}";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub word_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub word_count: usize,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub initial_cursor_offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotesIndexEntry {
    id: String,
    title: String,
    created_at: i64,
    updated_at: i64,
    word_count: usize,
}

#[derive(Debug, Clone, Default)]
struct NotesIndex {
    notes: Vec<NotesIndexEntry>,
}

fn legacy_doc_path(memory_dir: &Path) -> PathBuf {
    memory_dir.join(LEGACY_DOC_FILE)
}

fn notes_index_path(memory_dir: &Path) -> PathBuf {
    memory_dir.join(NOTES_INDEX_FILE)
}

fn notes_dir_path(memory_dir: &Path) -> PathBuf {
    memory_dir.join(NOTES_DIR)
}

fn note_path(memory_dir: &Path, id: &str) -> PathBuf {
    notes_dir_path(memory_dir).join(format!("{id}.md"))
}

pub fn normalize_content(content: &str) -> String {
    content.replace("\r\n", "\n").replace('\r', "\n")
}

fn normalize_title(title: Option<&str>, fallback: &str) -> String {
    let cleaned = title.unwrap_or("").trim().split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn count_words(content: &str) -> usize {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return 0;
    }
    trimmed.split_whitespace().count()
}

fn to_summary(entry: &NotesIndexEntry) -> NoteSummary {
    NoteSummary {
        id: entry.id.clone(),
        title: entry.title.clone(),
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        word_count: entry.word_count,
    }
}

fn sort_by_updated_at_desc(entries: &mut [NotesIndexEntry]) {
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
}

async fn ensure_notes_dir(memory_dir: &Path) -> Result<(), std::io::Error> {
    tokio::fs::create_dir_all(notes_dir_path(memory_dir)).await
}

async fn load_notes_index(memory_dir: &Path) -> Result<NotesIndex, std::io::Error> {
    let path = notes_index_path(memory_dir);
    if !file_exists(&path).await {
        return Ok(NotesIndex::default());
    }
    let raw = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    let source = if parsed.is_array() {
        parsed.as_array().cloned().unwrap_or_default()
    } else {
        parsed
            .get("notes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };

    let mut notes = Vec::new();
    for item in source {
        let Some(obj) = item.as_object() else {
            continue;
        };
        let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let title = obj.get("title").and_then(|v| v.as_str()).unwrap_or("");
        let created_at = obj.get("createdAt").and_then(|v| v.as_i64());
        let updated_at = obj.get("updatedAt").and_then(|v| v.as_i64());
        let word_count = obj.get("wordCount").and_then(|v| v.as_u64());
        if id.is_empty() || title.is_empty() || created_at.is_none() || updated_at.is_none() {
            continue;
        }
        notes.push(NotesIndexEntry {
            id: id.to_string(),
            title: title.to_string(),
            created_at: created_at.unwrap(),
            updated_at: updated_at.unwrap(),
            word_count: word_count.map(|n| n as usize).unwrap_or(0),
        });
    }
    sort_by_updated_at_desc(&mut notes);
    Ok(NotesIndex { notes })
}

async fn save_notes_index(
    state: &AppState,
    memory_dir: &Path,
    index: &NotesIndex,
) -> Result<(), std::io::Error> {
    let mut notes = index.notes.clone();
    sort_by_updated_at_desc(&mut notes);
    let payload = serde_json::json!({ "notes": notes });
    let pretty = serde_json::to_string_pretty(&payload).unwrap_or_else(|_| "{\"notes\":[]}".into());
    atomic_write_utf8(&state.write_chains, &notes_index_path(memory_dir), &pretty).await
}

fn format_note_template_today() -> String {
    Local::now().format("%b %e, %Y").to_string()
}

fn interpolate_note_template_string(value: &str) -> String {
    if !value.contains(NOTE_TEMPLATE_TODAY_TOKEN) {
        return value.to_string();
    }
    value.replace(NOTE_TEMPLATE_TODAY_TOKEN, &format_note_template_today())
}

fn strip_template_cursor_token(content: &str) -> (String, Option<usize>) {
    let re = Regex::new(r"\{\{\s*@cursor\s*\}\}").unwrap();
    let mut cursor_offset = None;
    let mut removed_chars = 0usize;
    let mut out = String::new();
    let mut last_index = 0usize;
    for mat in re.find_iter(content) {
        out.push_str(&content[last_index..mat.start()]);
        if cursor_offset.is_none() {
            cursor_offset = Some(mat.start().saturating_sub(removed_chars));
        }
        removed_chars += mat.as_str().len();
        last_index = mat.end();
    }
    if last_index == 0 {
        return (content.to_string(), None);
    }
    out.push_str(&content[last_index..]);
    (out, cursor_offset)
}

fn resolve_note_template_content(content: &str) -> (String, Option<usize>) {
    let interpolated = interpolate_note_template_string(content);
    strip_template_cursor_token(&interpolated)
}

fn parse_markdown_heading_line(line: &str) -> Option<(u8, usize)> {
    let re = Regex::new(r"^(\s{0,3})(#{1,6})\s+(.*)$").unwrap();
    let caps = re.captures(line)?;
    let hashes = caps.get(2)?.as_str();
    let indent = caps.get(1)?.as_str();
    let level = hashes.len() as u8;
    if !(1..=6).contains(&level) {
        return None;
    }
    Some((level, indent.len() + hashes.len() + 1))
}

pub fn title_from_markdown_content(content: &str, fallback: &str) -> String {
    let first_line = content
        .lines()
        .map(|line| line.trim_end())
        .find(|line| !line.trim().is_empty());
    let Some(first_line) = first_line else {
        return fallback.to_string();
    };
    let Some((level, marker_len)) = parse_markdown_heading_line(first_line) else {
        return fallback.to_string();
    };
    if level != 1 {
        return fallback.to_string();
    }
    let heading_text = first_line[marker_len.min(first_line.len())..].trim();
    if heading_text.is_empty() {
        return fallback.to_string();
    }
    if heading_text.len() > 80 {
        format!("{}...", heading_text[..80].trim_end())
    } else {
        heading_text.to_string()
    }
}

async fn migrate_legacy_doc(state: &AppState, memory_dir: &Path) -> Result<(), std::io::Error> {
    let index = load_notes_index(memory_dir).await?;
    if !index.notes.is_empty() {
        return Ok(());
    }
    let legacy_path = legacy_doc_path(memory_dir);
    if !file_exists(&legacy_path).await {
        return Ok(());
    }
    let content = tokio::fs::read_to_string(&legacy_path).await?;
    let metadata = tokio::fs::metadata(&legacy_path).await?;
    let normalized = normalize_content(&content);
    let created_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    let id = Uuid::new_v4().to_string();
    ensure_notes_dir(memory_dir).await?;
    atomic_write_utf8(
        &state.write_chains,
        &note_path(memory_dir, &id),
        &normalized,
    )
    .await?;
    save_notes_index(
        state,
        memory_dir,
        &NotesIndex {
            notes: vec![NotesIndexEntry {
                id,
                title: title_from_markdown_content(&normalized, LEGACY_IMPORTED_NOTE_TITLE),
                created_at,
                updated_at: created_at,
                word_count: count_words(&normalized),
            }],
        },
    )
    .await
}

async fn ensure_notes_ready(state: &AppState, memory_dir: &Path) -> Result<NotesIndex, std::io::Error> {
    ensure_notes_dir(memory_dir).await?;
    migrate_legacy_doc(state, memory_dir).await?;
    load_notes_index(memory_dir).await
}

pub async fn list_notes(state: &AppState) -> Result<Vec<NoteSummary>, std::io::Error> {
    let memory_dir = get_app_state_dir();
    let index = ensure_notes_ready(state, &memory_dir).await?;
    let mut notes_with_counts = Vec::new();
    let mut changed = false;

    for entry in &index.notes {
        let path = note_path(&memory_dir, &entry.id);
        let content = if file_exists(&path).await {
            tokio::fs::read_to_string(&path).await.unwrap_or_default()
        } else {
            String::new()
        };
        let word_count = count_words(&content);
        if word_count != entry.word_count {
            changed = true;
        }
        notes_with_counts.push(NotesIndexEntry {
            id: entry.id.clone(),
            title: entry.title.clone(),
            created_at: entry.created_at,
            updated_at: entry.updated_at,
            word_count,
        });
    }

    if changed {
        save_notes_index(state, &memory_dir, &NotesIndex { notes: notes_with_counts.clone() }).await?;
    }

    sort_by_updated_at_desc(&mut notes_with_counts);
    Ok(notes_with_counts.iter().map(to_summary).collect())
}

pub async fn create_note(
    state: &AppState,
    title: Option<&str>,
    content: &str,
) -> Result<Note, std::io::Error> {
    let memory_dir = get_app_state_dir();
    let index = ensure_notes_ready(state, &memory_dir).await?;
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let (resolved_content, cursor_offset) = resolve_note_template_content(content);
    let normalized_content = normalize_content(&resolved_content);
    let interpolated_title = title.map(interpolate_note_template_string);
    let fallback_title = normalize_title(interpolated_title.as_deref(), UNTITLED_NOTE_TITLE);
    let entry = NotesIndexEntry {
        id: id.clone(),
        title: title_from_markdown_content(&normalized_content, &fallback_title),
        created_at: now,
        updated_at: now,
        word_count: count_words(&normalized_content),
    };
    atomic_write_utf8(
        &state.write_chains,
        &note_path(&memory_dir, &id),
        &normalized_content,
    )
    .await?;
    let mut notes = index.notes;
    notes.insert(0, entry.clone());
    save_notes_index(state, &memory_dir, &NotesIndex { notes }).await?;

    let normalized_cursor_offset = cursor_offset.map(|offset| {
        normalize_content(&resolved_content[..offset.min(resolved_content.len())]).len()
    });
    let initial_cursor_offset = normalized_cursor_offset.map(|offset| {
        offset.min(normalized_content.len())
    });

    Ok(Note {
        id: entry.id,
        title: entry.title,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        word_count: entry.word_count,
        content: normalized_content,
        initial_cursor_offset,
    })
}

pub async fn read_note(state: &AppState, id: &str) -> Result<Option<Note>, std::io::Error> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return Ok(None);
    }
    let memory_dir = get_app_state_dir();
    let index = ensure_notes_ready(state, &memory_dir).await?;
    let Some(entry) = index.notes.iter().find(|item| item.id == clean_id) else {
        return Ok(None);
    };
    let path = note_path(&memory_dir, clean_id);
    let content = if file_exists(&path).await {
        tokio::fs::read_to_string(&path).await.unwrap_or_default()
    } else {
        String::new()
    };
    Ok(Some(Note {
        id: entry.id.clone(),
        title: entry.title.clone(),
        created_at: entry.created_at,
        updated_at: entry.updated_at,
        word_count: entry.word_count,
        content,
        initial_cursor_offset: None,
    }))
}

pub async fn save_note(state: &AppState, id: &str, content: &str) -> Result<Note, std::io::Error> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "saveNote requires a note id",
        ));
    }
    let memory_dir = get_app_state_dir();
    let index = ensure_notes_ready(state, &memory_dir).await?;
    let note_index = index
        .notes
        .iter()
        .position(|item| item.id == clean_id)
        .ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                format!("Note not found: {clean_id}"),
            )
        })?;
    let normalized = normalize_content(content);
    atomic_write_utf8(
        &state.write_chains,
        &note_path(&memory_dir, clean_id),
        &normalized,
    )
    .await?;
    let now = chrono::Utc::now().timestamp_millis();
    let current = &index.notes[note_index];
    let updated_entry = NotesIndexEntry {
        id: current.id.clone(),
        title: title_from_markdown_content(&normalized, &current.title),
        created_at: current.created_at,
        updated_at: now,
        word_count: count_words(&normalized),
    };
    let mut next = index.notes;
    next[note_index] = updated_entry.clone();
    save_notes_index(state, &memory_dir, &NotesIndex { notes: next }).await?;
    Ok(Note {
        id: updated_entry.id,
        title: updated_entry.title,
        created_at: updated_entry.created_at,
        updated_at: updated_entry.updated_at,
        word_count: updated_entry.word_count,
        content: normalized,
        initial_cursor_offset: None,
    })
}

pub async fn delete_note(state: &AppState, id: &str) -> Result<Vec<NoteSummary>, std::io::Error> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return list_notes(state).await;
    }
    let memory_dir = get_app_state_dir();
    let index = ensure_notes_ready(state, &memory_dir).await?;
    let before_len = index.notes.len();
    let next: Vec<NotesIndexEntry> = index
        .notes
        .into_iter()
        .filter(|item| item.id != clean_id)
        .collect();
    if next.len() == before_len {
        return Ok(next.iter().map(to_summary).collect());
    }
    let path = note_path(&memory_dir, clean_id);
    if file_exists(&path).await {
        let _ = tokio::fs::remove_file(path).await;
    }
    save_notes_index(state, &memory_dir, &NotesIndex { notes: next.clone() }).await?;
    Ok(next.iter().map(to_summary).collect())
}

pub async fn show_note_in_folder(id: &str) -> Result<(), std::io::Error> {
    let clean_id = id.trim();
    if clean_id.is_empty() {
        return Ok(());
    }
    let note_path = note_path(&get_app_state_dir(), clean_id);
    if !note_path.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("Note file not found: {clean_id}"),
        ));
    }
    crate::memory::show_item_in_folder(&note_path)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteEditProposal {
    pub proposed_text: String,
}

pub async fn propose_note_edit(input: &serde_json::Value) -> Result<NoteEditProposal, String> {
    let selected = input
        .get("selectedText")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if selected.is_empty() {
        return Err("Cannot propose edit for empty selection.".into());
    }
    let prompt = input
        .get("prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if prompt.is_empty() {
        return Err("Prompt is required.".into());
    }
    let api_key = crate::credentials::resolve_openai_api_key().await.trim().to_string();
    if api_key.is_empty() {
        return Err("OpenAI API key required.".into());
    }
    let system = "You edit note selections. Return only the revised text.";
    let user = format!("Instruction: {prompt}\n\nSelection:\n{selected}");
    let text = crate::openai::chat_completion_json(
        &api_key,
        crate::openai::openai_chat_model().as_str(),
        system,
        &user,
        1500,
        60,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(NoteEditProposal {
        proposed_text: text,
    })
}

pub async fn propose_note_spell_check(input: &serde_json::Value) -> Result<NoteEditProposal, String> {
    let selected = input
        .get("selectedText")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if selected.is_empty() {
        return Err("Cannot spell check an empty selection.".into());
    }
    let api_key = crate::credentials::resolve_openai_api_key().await.trim().to_string();
    if api_key.is_empty() {
        return Err("OpenAI API key required.".into());
    }
    let system = "Fix spelling and grammar. Return only corrected text.";
    let text = crate::openai::chat_completion_json(
        &api_key,
        crate::openai::openai_chat_model().as_str(),
        system,
        selected,
        1500,
        60,
    )
    .await
    .map_err(|e| e.to_string())?;
    Ok(NoteEditProposal {
        proposed_text: text,
    })
}

