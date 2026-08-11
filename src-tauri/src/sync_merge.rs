use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::canonical_json::{to_string_compact_canonical, to_vec_pretty_canonical};
use crate::settings::strip_settings_secrets;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncFileChoice {
    Local,
    Remote,
    Merge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SyncFileChangeKind {
    Unchanged,
    #[serde(rename = "local-only")]
    LocalOnly,
    #[serde(rename = "remote-only")]
    RemoteOnly,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictFileEntry {
    pub path: String,
    pub kind: SyncFileChangeKind,
    pub default_choice: SyncFileChoice,
    pub supports_merge: bool,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_preview: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictSummary {
    pub unchanged: usize,
    pub local_only: usize,
    pub remote_only: usize,
    pub conflict: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflictReview {
    pub files: Vec<SyncConflictFileEntry>,
    pub summary: SyncConflictSummary,
}

const MERGEABLE_PATHS: &[&str] = &[
    "app-state/conversations.json",
    "app-state/tasks.json",
    "app-state/notes.json",
    "app-state/images.json",
    "app-state/user_memory.json",
    "settings/settings.json",
];

/// Legacy paths that may appear in old sync bundles; ignore rather than fail.
const IGNORED_SYNC_PATHS: &[&str] = &["app-state/plans.json"];

const IMAGES_INDEX_PATH: &str = "app-state/images.json";
const IMAGES_DIR_PREFIX: &str = "app-state/images/";
const NOTES_INDEX_PATH: &str = "app-state/notes.json";
const NOTES_DIR_PREFIX: &str = "app-state/notes/";

fn is_ignored_sync_path(path: &str) -> bool {
    IGNORED_SYNC_PATHS.contains(&path)
}

fn is_image_library_path(path: &str) -> bool {
    path == IMAGES_INDEX_PATH || path.starts_with(IMAGES_DIR_PREFIX)
}

fn is_note_body_path(path: &str) -> bool {
    path.starts_with(NOTES_DIR_PREFIX) && path.ends_with(".md")
}

fn note_id_from_body_path(path: &str) -> Option<&str> {
    path.strip_prefix(NOTES_DIR_PREFIX)?
        .strip_suffix(".md")
        .filter(|id| !id.is_empty())
}

fn file_bytes_equal(a: &[u8], b: &[u8]) -> bool {
    a == b
}

fn truncate_preview(text: &str, max_bytes: usize) -> String {
    if text.len() <= max_bytes {
        return text.to_string();
    }
    let mut end = max_bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &text[..end])
}

fn preview_text(bytes: Option<&[u8]>, max_len: usize) -> Option<String> {
    let bytes = bytes?;
    if bytes.is_empty() {
        return None;
    }
    let text = String::from_utf8_lossy(bytes)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if text.is_empty() {
        return Some("(empty)".into());
    }
    Some(truncate_preview(&text, max_len))
}

fn label_for_path(path: &str) -> String {
    if let Some(name) = path.strip_prefix("app-state/notes/") {
        return if name.ends_with(".md") {
            name[..name.len() - 3].to_string()
        } else {
            name.to_string()
        };
    }
    if let Some(rest) = path.strip_prefix("app-state/") {
        if path.starts_with("app-state/messages_") {
            return rest.to_string();
        }
    }
    if path == IMAGES_INDEX_PATH {
        return "Images library".into();
    }
    if let Some(name) = path.strip_prefix(IMAGES_DIR_PREFIX) {
        return format!("Image file {name}");
    }
    match path {
        "app-state/conversations.json" => "Conversation list".into(),
        "app-state/tasks.json" => "Tasks".into(),
        "app-state/notes.json" => "Notes".into(),
        "app-state/user_memory.json" => "User context".into(),
        "app-state/writing.md" => "Writing surface".into(),
        "settings/settings.json" => "App preferences".into(),
        other => other.to_string(),
    }
}

fn supports_merge_for_path(path: &str) -> bool {
    if is_image_library_path(path) {
        return true;
    }
    if is_note_body_path(path) {
        return true;
    }
    if MERGEABLE_PATHS.contains(&path) {
        return true;
    }
    path.starts_with("app-state/messages_")
}

fn default_choice_for_kind(kind: SyncFileChangeKind, path: &str) -> SyncFileChoice {
    match kind {
        SyncFileChangeKind::LocalOnly => SyncFileChoice::Local,
        SyncFileChangeKind::RemoteOnly => SyncFileChoice::Remote,
        SyncFileChangeKind::Unchanged => SyncFileChoice::Local,
        SyncFileChangeKind::Conflict => {
            if supports_merge_for_path(path) {
                SyncFileChoice::Merge
            } else {
                SyncFileChoice::Local
            }
        }
    }
}

fn image_library_paths(
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
) -> Vec<String> {
    let mut paths: Vec<String> = local_files
        .keys()
        .chain(remote_files.keys())
        .filter(|path| is_image_library_path(path))
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    paths.sort();
    paths
}

fn note_body_paths(
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
) -> Vec<String> {
    let mut paths: Vec<String> = local_files
        .keys()
        .chain(remote_files.keys())
        .filter(|path| is_note_body_path(path))
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    paths.sort();
    paths
}

fn image_library_is_dirty(
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
) -> bool {
    for path in image_library_paths(local_files, remote_files) {
        match (local_files.get(&path), remote_files.get(&path)) {
            (Some(local), Some(remote)) if !file_bytes_equal(local, remote) => return true,
            (Some(_), None) | (None, Some(_)) => return true,
            _ => {}
        }
    }
    false
}

fn notes_are_dirty(
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
) -> bool {
    match (
        local_files.get(NOTES_INDEX_PATH),
        remote_files.get(NOTES_INDEX_PATH),
    ) {
        (Some(local), Some(remote)) if !file_bytes_equal(local, remote) => return true,
        (Some(_), None) | (None, Some(_)) => return true,
        _ => {}
    }
    for path in note_body_paths(local_files, remote_files) {
        match (local_files.get(&path), remote_files.get(&path)) {
            (Some(local), Some(remote)) if !file_bytes_equal(local, remote) => return true,
            (Some(_), None) | (None, Some(_)) => return true,
            _ => {}
        }
    }
    false
}

fn apply_mergeable_library_defaults(
    choices: &mut HashMap<String, SyncFileChoice>,
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
) {
    if image_library_is_dirty(local_files, remote_files) {
        for path in image_library_paths(local_files, remote_files) {
            let kind = match (local_files.get(&path), remote_files.get(&path)) {
                (Some(_), Some(_)) => SyncFileChangeKind::Conflict,
                (Some(_), None) => SyncFileChangeKind::LocalOnly,
                (None, Some(_)) => SyncFileChangeKind::RemoteOnly,
                (None, None) => continue,
            };
            choices.insert(
                path,
                match kind {
                    SyncFileChangeKind::LocalOnly => SyncFileChoice::Local,
                    SyncFileChangeKind::RemoteOnly => SyncFileChoice::Remote,
                    _ => SyncFileChoice::Merge,
                },
            );
        }
    }
    if notes_are_dirty(local_files, remote_files) {
        choices.insert(NOTES_INDEX_PATH.to_string(), SyncFileChoice::Merge);
        for path in note_body_paths(local_files, remote_files) {
            let kind = match (local_files.get(&path), remote_files.get(&path)) {
                (Some(_), Some(_)) => SyncFileChangeKind::Conflict,
                (Some(_), None) => SyncFileChangeKind::LocalOnly,
                (None, Some(_)) => SyncFileChangeKind::RemoteOnly,
                (None, None) => continue,
            };
            choices.insert(
                path,
                match kind {
                    SyncFileChangeKind::LocalOnly => SyncFileChoice::Local,
                    SyncFileChangeKind::RemoteOnly => SyncFileChoice::Remote,
                    _ => SyncFileChoice::Merge,
                },
            );
        }
    }
}

pub fn build_sync_conflict_review(
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
) -> SyncConflictReview {
    let mut paths: Vec<String> = local_files
        .keys()
        .chain(remote_files.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    paths.sort();

    let mut summary = SyncConflictSummary {
        unchanged: 0,
        local_only: 0,
        remote_only: 0,
        conflict: 0,
    };
    let mut files = Vec::new();

    for path in paths {
        if is_ignored_sync_path(&path) {
            continue;
        }
        let local = local_files.get(&path).map(|b| b.as_slice());
        let remote = remote_files.get(&path).map(|b| b.as_slice());
        let kind = match (local, remote) {
            (Some(l), Some(r)) => {
                if file_bytes_equal(l, r) {
                    SyncFileChangeKind::Unchanged
                } else {
                    SyncFileChangeKind::Conflict
                }
            }
            (Some(_), None) => SyncFileChangeKind::LocalOnly,
            (None, Some(_)) => SyncFileChangeKind::RemoteOnly,
            (None, None) => continue,
        };

        match kind {
            SyncFileChangeKind::Unchanged => summary.unchanged += 1,
            SyncFileChangeKind::LocalOnly => summary.local_only += 1,
            SyncFileChangeKind::RemoteOnly => summary.remote_only += 1,
            SyncFileChangeKind::Conflict => summary.conflict += 1,
        }

        files.push(SyncConflictFileEntry {
            default_choice: default_choice_for_kind(kind, &path),
            supports_merge: supports_merge_for_path(&path),
            label: label_for_path(&path),
            local_preview: preview_text(local, 120),
            remote_preview: preview_text(remote, 120),
            path,
            kind,
        });
    }

    if image_library_is_dirty(local_files, remote_files) {
        for file in &mut files {
            if is_image_library_path(&file.path) {
                file.supports_merge = true;
                file.default_choice = match file.kind {
                    SyncFileChangeKind::LocalOnly => SyncFileChoice::Local,
                    SyncFileChangeKind::RemoteOnly => SyncFileChoice::Remote,
                    SyncFileChangeKind::Conflict | SyncFileChangeKind::Unchanged => {
                        SyncFileChoice::Merge
                    }
                };
            }
        }
    }
    if notes_are_dirty(local_files, remote_files) {
        for file in &mut files {
            if file.path == NOTES_INDEX_PATH || is_note_body_path(&file.path) {
                file.supports_merge = true;
                file.default_choice = match file.kind {
                    SyncFileChangeKind::LocalOnly => SyncFileChoice::Local,
                    SyncFileChangeKind::RemoteOnly => SyncFileChoice::Remote,
                    SyncFileChangeKind::Conflict | SyncFileChangeKind::Unchanged => {
                        SyncFileChoice::Merge
                    }
                };
            }
        }
    }

    SyncConflictReview { files, summary }
}

pub fn build_default_merge_choices(
    review: &SyncConflictReview,
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
) -> HashMap<String, SyncFileChoice> {
    let mut choices = HashMap::new();
    for file in &review.files {
        if file.kind == SyncFileChangeKind::Unchanged {
            choices.insert(file.path.clone(), SyncFileChoice::Local);
        } else {
            choices.insert(file.path.clone(), file.default_choice);
        }
    }
    apply_mergeable_library_defaults(&mut choices, local_files, remote_files);
    choices
}

fn parse_json(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap_or(json!({}))
}

fn ts_from_value(value: &Value) -> i64 {
    let Some(obj) = value.as_object() else {
        return 0;
    };
    for key in ["updatedAt", "createdAt"] {
        if let Some(n) = obj.get(key).and_then(|v| v.as_i64()) {
            return n;
        }
    }
    0
}

fn merge_json_records(local: &Value, remote: &Value) -> Value {
    let Some(local_obj) = local.as_object() else {
        return remote.clone();
    };
    let Some(remote_obj) = remote.as_object() else {
        return local.clone();
    };

    let mut merged = remote_obj.clone();
    for (key, local_value) in local_obj {
        match merged.get(key) {
            None => {
                merged.insert(key.clone(), local_value.clone());
            }
            Some(remote_value) => {
                if remote_value == local_value {
                    continue;
                }
                let local_ts = ts_from_value(local_value);
                let remote_ts = ts_from_value(remote_value);
                if local_ts >= remote_ts {
                    merged.insert(key.clone(), local_value.clone());
                }
            }
        }
    }
    Value::Object(merged)
}

fn merge_id_array_json(local: &[u8], remote: &[u8], array_key: &str) -> Vec<u8> {
    let local_state = parse_json(local);
    let remote_state = parse_json(remote);
    let mut by_id: HashMap<String, Value> = HashMap::new();

    if let Some(rows) = remote_state.get(array_key).and_then(|v| v.as_array()) {
        for row in rows {
            if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
                by_id.insert(id.to_string(), row.clone());
            }
        }
    }
    if let Some(rows) = local_state.get(array_key).and_then(|v| v.as_array()) {
        for row in rows {
            let Some(id) = row.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            match by_id.get(id) {
                None => {
                    by_id.insert(id.to_string(), row.clone());
                }
                Some(existing) => {
                    let pick = if ts_from_value(row) >= ts_from_value(existing) {
                        row.clone()
                    } else {
                        existing.clone()
                    };
                    by_id.insert(id.to_string(), pick);
                }
            }
        }
    }

    let mut rows: Vec<Value> = by_id.into_values().collect();
    rows.sort_by(|a, b| ts_from_value(b).cmp(&ts_from_value(a)));
    to_vec_pretty_canonical(&json!({ array_key: rows }))
}

fn merge_tasks_json(local: &[u8], remote: &[u8]) -> Vec<u8> {
    merge_id_array_json(local, remote, "tasks")
}

fn merge_notes_json(local: &[u8], remote: &[u8]) -> Vec<u8> {
    merge_id_array_json(local, remote, "notes")
}

fn note_ts_by_id(index_bytes: Option<&[u8]>) -> HashMap<String, i64> {
    let mut out = HashMap::new();
    let Some(bytes) = index_bytes else {
        return out;
    };
    let parsed = parse_json(bytes);
    let Some(rows) = parsed.get("notes").and_then(|v| v.as_array()) else {
        return out;
    };
    for row in rows {
        if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
            out.insert(id.to_string(), ts_from_value(row));
        }
    }
    out
}

fn merge_image_record(local: &Value, remote: &Value) -> Value {
    let local_is_newer = ts_from_value(local) >= ts_from_value(remote);
    let (newer, older) = if local_is_newer {
        (local, remote)
    } else {
        (remote, local)
    };

    let mut versions_by_id: HashMap<String, Value> = HashMap::new();
    for source in [older, newer] {
        if let Some(versions) = source.get("versions").and_then(|v| v.as_array()) {
            for version in versions {
                if let Some(id) = version.get("id").and_then(|v| v.as_str()) {
                    versions_by_id.insert(id.to_string(), version.clone());
                }
            }
        }
    }
    let mut versions: Vec<Value> = versions_by_id.into_values().collect();
    versions.sort_by(|a, b| {
        let ta = a.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0);
        let tb = b.get("createdAt").and_then(|v| v.as_i64()).unwrap_or(0);
        ta.cmp(&tb).then_with(|| {
            let ia = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let ib = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
            ia.cmp(ib)
        })
    });

    let mut merged = newer.clone();
    if let Some(obj) = merged.as_object_mut() {
        let active = obj
            .get("activeVersionId")
            .and_then(|v| v.as_str())
            .map(str::to_string);
        let active_ok = active
            .as_ref()
            .map(|id| versions.iter().any(|v| v.get("id").and_then(|x| x.as_str()) == Some(id)))
            .unwrap_or(false);
        if !active_ok {
            if let Some(last) = versions.last() {
                if let Some(id) = last.get("id").cloned() {
                    obj.insert("activeVersionId".into(), id);
                }
            }
        }
        obj.insert("versions".into(), Value::Array(versions));
    }
    merged
}

fn merge_images_json(local: &[u8], remote: &[u8]) -> Vec<u8> {
    let local_state = parse_json(local);
    let remote_state = parse_json(remote);
    let mut by_id: HashMap<String, Value> = HashMap::new();

    if let Some(rows) = remote_state.get("images").and_then(|v| v.as_array()) {
        for row in rows {
            if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
                by_id.insert(id.to_string(), row.clone());
            }
        }
    }
    if let Some(rows) = local_state.get("images").and_then(|v| v.as_array()) {
        for row in rows {
            let Some(id) = row.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            match by_id.get(id) {
                None => {
                    by_id.insert(id.to_string(), row.clone());
                }
                Some(existing) => {
                    let merged = merge_image_record(row, existing);
                    by_id.insert(id.to_string(), merged);
                }
            }
        }
    }

    let mut images: Vec<Value> = by_id.into_values().collect();
    images.sort_by(|a, b| ts_from_value(b).cmp(&ts_from_value(a)));
    to_vec_pretty_canonical(&json!({ "images": images }))
}

fn referenced_image_blob_paths(images_json: &[u8]) -> HashSet<String> {
    let mut out = HashSet::new();
    let parsed = parse_json(images_json);
    let Some(rows) = parsed.get("images").and_then(|v| v.as_array()) else {
        return out;
    };
    for row in rows {
        if let Some(name) = row.get("fileName").and_then(|v| v.as_str()) {
            if !name.is_empty() {
                out.insert(format!("{IMAGES_DIR_PREFIX}{name}"));
            }
        }
        if let Some(versions) = row.get("versions").and_then(|v| v.as_array()) {
            for version in versions {
                if let Some(name) = version.get("fileName").and_then(|v| v.as_str()) {
                    if !name.is_empty() {
                        out.insert(format!("{IMAGES_DIR_PREFIX}{name}"));
                    }
                }
            }
        }
    }
    out
}

fn apply_image_library_merge(
    merged: &mut HashMap<String, Vec<u8>>,
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
) {
    if !image_library_is_dirty(local_files, remote_files) {
        for path in image_library_paths(local_files, remote_files) {
            if let Some(bytes) = local_files.get(&path).or_else(|| remote_files.get(&path)) {
                merged.insert(path, bytes.clone());
            }
        }
        return;
    }
    let merged_index = match (
        local_files.get(IMAGES_INDEX_PATH),
        remote_files.get(IMAGES_INDEX_PATH),
    ) {
        (Some(local), Some(remote)) => merge_images_json(local, remote),
        (Some(local), None) => local.clone(),
        (None, Some(remote)) => remote.clone(),
        (None, None) => return,
    };
    let refs = referenced_image_blob_paths(&merged_index);
    merged.insert(IMAGES_INDEX_PATH.to_string(), merged_index);

    for path in image_library_paths(local_files, remote_files) {
        if path == IMAGES_INDEX_PATH {
            continue;
        }
        if !refs.contains(&path) {
            merged.remove(&path);
            continue;
        }
        match (local_files.get(&path), remote_files.get(&path)) {
            (Some(local), Some(remote)) => {
                merged.insert(
                    path,
                    if local.len() >= remote.len() {
                        local.clone()
                    } else {
                        remote.clone()
                    },
                );
            }
            (Some(local), None) => {
                merged.insert(path, local.clone());
            }
            (None, Some(remote)) => {
                merged.insert(path, remote.clone());
            }
            (None, None) => {}
        }
    }
}

fn apply_notes_merge(
    merged: &mut HashMap<String, Vec<u8>>,
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
) {
    if !notes_are_dirty(local_files, remote_files) {
        if let Some(bytes) = local_files
            .get(NOTES_INDEX_PATH)
            .or_else(|| remote_files.get(NOTES_INDEX_PATH))
        {
            merged.insert(NOTES_INDEX_PATH.to_string(), bytes.clone());
        }
        for path in note_body_paths(local_files, remote_files) {
            if let Some(bytes) = local_files.get(&path).or_else(|| remote_files.get(&path)) {
                merged.insert(path, bytes.clone());
            }
        }
        return;
    }
    let merged_index = match (
        local_files.get(NOTES_INDEX_PATH),
        remote_files.get(NOTES_INDEX_PATH),
    ) {
        (Some(local), Some(remote)) => merge_notes_json(local, remote),
        (Some(local), None) => local.clone(),
        (None, Some(remote)) => remote.clone(),
        (None, None) => Vec::new(),
    };
    let mut kept_ids = HashSet::new();
    if !merged_index.is_empty() {
        let parsed = parse_json(&merged_index);
        if let Some(rows) = parsed.get("notes").and_then(|v| v.as_array()) {
            for row in rows {
                if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
                    kept_ids.insert(id.to_string());
                }
            }
        }
        merged.insert(NOTES_INDEX_PATH.to_string(), merged_index);
    }

    let local_ts = note_ts_by_id(local_files.get(NOTES_INDEX_PATH).map(|b| b.as_slice()));
    let remote_ts = note_ts_by_id(remote_files.get(NOTES_INDEX_PATH).map(|b| b.as_slice()));

    for path in note_body_paths(local_files, remote_files) {
        let Some(id) = note_id_from_body_path(&path).map(str::to_string) else {
            continue;
        };
        if !kept_ids.is_empty() && !kept_ids.contains(&id) {
            merged.remove(&path);
            continue;
        }
        let bytes = match (local_files.get(&path), remote_files.get(&path)) {
            (Some(local), Some(remote)) if file_bytes_equal(local, remote) => local.clone(),
            (Some(local), Some(remote)) => {
                let lt = local_ts.get(&id).copied().unwrap_or(0);
                let rt = remote_ts.get(&id).copied().unwrap_or(0);
                if lt >= rt {
                    local.clone()
                } else {
                    remote.clone()
                }
            }
            (Some(local), None) => local.clone(),
            (None, Some(remote)) => remote.clone(),
            (None, None) => continue,
        };
        merged.insert(path, bytes);
    }
}

fn merge_messages_json(local: &[u8], remote: &[u8]) -> Vec<u8> {
    let local_rows = parse_json(local);
    let remote_rows = parse_json(remote);
    let local_arr = local_rows.as_array().cloned().unwrap_or_default();
    let remote_arr = remote_rows.as_array().cloned().unwrap_or_default();

    let mut seen = HashSet::new();
    let mut merged = Vec::new();
    for row in remote_arr.into_iter().chain(local_arr) {
        if !row.is_object() {
            continue;
        }
        let stamp = to_string_compact_canonical(&row);
        if seen.contains(&stamp) {
            continue;
        }
        seen.insert(stamp);
        merged.push(row);
    }
    merged.sort_by_key(|row| ts_from_value(row));
    to_vec_pretty_canonical(&Value::Array(merged))
}

fn merge_settings_json(local: &[u8], remote: &[u8]) -> Vec<u8> {
    let mut local_obj = parse_json(local);
    let mut remote_obj = parse_json(remote);
    strip_settings_secrets(&mut local_obj);
    strip_settings_secrets(&mut remote_obj);
    let mut merged = merge_json_records(&local_obj, &remote_obj);
    if let Some(sync) = local_obj.get("sync") {
        merged["sync"] = sync.clone();
    }
    strip_settings_secrets(&mut merged);
    to_vec_pretty_canonical(&merged)
}

pub fn merge_file_bytes(path: &str, local: &[u8], remote: &[u8]) -> Vec<u8> {
    if path == "app-state/tasks.json" {
        return merge_tasks_json(local, remote);
    }
    if path == NOTES_INDEX_PATH {
        return merge_notes_json(local, remote);
    }
    if path == IMAGES_INDEX_PATH {
        return merge_images_json(local, remote);
    }
    if path.starts_with("app-state/messages_") {
        return merge_messages_json(local, remote);
    }
    if path == "settings/settings.json" {
        return merge_settings_json(local, remote);
    }
    if is_note_body_path(path) {
        return if local.len() >= remote.len() {
            local.to_vec()
        } else {
            remote.to_vec()
        };
    }
    if path.ends_with(".json") {
        let local_obj = parse_json(local);
        let remote_obj = parse_json(remote);
        if local_obj.is_object() && remote_obj.is_object() {
            return to_vec_pretty_canonical(&merge_json_records(&local_obj, &remote_obj));
        }
    }
    if local.len() >= remote.len() {
        local.to_vec()
    } else {
        remote.to_vec()
    }
}

pub fn resolve_file_bytes(
    path: &str,
    choice: SyncFileChoice,
    local: Option<&[u8]>,
    remote: Option<&[u8]>,
) -> Option<Vec<u8>> {
    match choice {
        SyncFileChoice::Local => local.map(|b| b.to_vec()),
        SyncFileChoice::Remote => remote.map(|b| b.to_vec()),
        SyncFileChoice::Merge => {
            let (Some(l), Some(r)) = (local, remote) else {
                return local.or(remote).map(|b| b.to_vec());
            };
            Some(merge_file_bytes(path, l, r))
        }
    }
}

pub fn build_merged_file_map(
    local_files: &HashMap<String, Vec<u8>>,
    remote_files: &HashMap<String, Vec<u8>>,
    choices: &HashMap<String, SyncFileChoice>,
) -> HashMap<String, Vec<u8>> {
    let mut paths: Vec<String> = local_files
        .keys()
        .chain(remote_files.keys())
        .cloned()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    paths.sort();

    let mut effective_choices = choices.clone();
    apply_mergeable_library_defaults(&mut effective_choices, local_files, remote_files);

    let mut merged = HashMap::new();
    for path in paths {
        if is_ignored_sync_path(&path) {
            continue;
        }
        // Notes + images are finalized in dedicated passes so index and blobs stay consistent.
        if is_image_library_path(&path) || path == NOTES_INDEX_PATH || is_note_body_path(&path) {
            continue;
        }
        let kind = match (local_files.get(&path), remote_files.get(&path)) {
            (Some(_), Some(_)) => SyncFileChangeKind::Conflict,
            (Some(_), None) => SyncFileChangeKind::LocalOnly,
            (None, Some(_)) => SyncFileChangeKind::RemoteOnly,
            (None, None) => continue,
        };
        let choice = effective_choices
            .get(&path)
            .copied()
            .unwrap_or_else(|| default_choice_for_kind(kind, &path));
        if let Some(bytes) = resolve_file_bytes(
            &path,
            choice,
            local_files.get(&path).map(|b| b.as_slice()),
            remote_files.get(&path).map(|b| b.as_slice()),
        ) {
            merged.insert(path, bytes);
        }
    }
    apply_image_library_merge(&mut merged, local_files, remote_files);
    apply_notes_merge(&mut merged, local_files, remote_files);
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_canonical_json_for_conversations_merge_golden_fixture() {
        const EXPECTED: &str =
            include_str!("../../src/shared/fixtures/syncMerge/conversations-merge.expected.json");
        let merged = merge_file_bytes(
            "app-state/conversations.json",
            br#"{"a":{"title":"A","createdAt":1}}"#,
            br#"{"b":{"title":"B","createdAt":2}}"#,
        );
        assert_eq!(String::from_utf8_lossy(&merged), EXPECTED.trim_end());
    }

    #[test]
    fn emits_canonical_json_for_tasks_merge_golden_fixture() {
        const EXPECTED: &str =
            include_str!("../../src/shared/fixtures/syncMerge/tasks-merge.expected.json");
        let merged = merge_file_bytes(
            "app-state/tasks.json",
            br#"{"tasks":[{"id":"t1","title":"Local","updatedAt":20}]}"#,
            br#"{"tasks":[{"id":"t1","title":"Remote","updatedAt":10},{"id":"t2","title":"Only remote","updatedAt":5}]}"#,
        );
        assert_eq!(String::from_utf8_lossy(&merged), EXPECTED.trim_end());
    }

    #[test]
    fn emits_canonical_json_for_messages_merge_golden_fixture() {
        const EXPECTED: &str =
            include_str!("../../src/shared/fixtures/syncMerge/messages-merge.expected.json");
        let merged = merge_file_bytes(
            "app-state/messages_abc.json",
            br#"[{"id":"m1","role":"user","content":"hi","createdAt":1},{"id":"m2","role":"assistant","content":"dup","createdAt":2}]"#,
            br#"[{"role":"assistant","content":"dup","createdAt":2,"id":"m2"},{"id":"m3","role":"user","content":"new","createdAt":3}]"#,
        );
        assert_eq!(String::from_utf8_lossy(&merged), EXPECTED.trim_end());
    }

    #[test]
    fn message_dedup_stamp_matches_golden_fixture() {
        use crate::canonical_json::to_string_compact_canonical;
        const EXPECTED: &str =
            include_str!("../../src/shared/fixtures/syncMerge/message-dedup-stamp.expected.txt");
        let row = json!({
            "id": "m2",
            "role": "assistant",
            "content": "dup",
            "createdAt": 2
        });
        assert_eq!(to_string_compact_canonical(&row), EXPECTED.trim_end());
    }

    #[test]
    fn preview_truncates_on_char_boundary_not_byte_boundary() {
        // U+2019 (') is three UTF-8 bytes; a naive byte slice at 120 panics inside it.
        let apostrophe = '\u{2019}';
        let prefix = "x".repeat(118);
        let content = format!("[ {{ \"content\": \"{prefix}ab{apostrophe}cd\" }} ]");
        let review = build_sync_conflict_review(
            &HashMap::from([("app-state/messages_abc.json".into(), content.into_bytes())]),
            &HashMap::new(),
        );
        let preview = review.files[0].local_preview.as_ref().unwrap();
        assert!(preview.ends_with('…'));
        assert!(preview.is_char_boundary(preview.len() - '…'.len_utf8()));
    }

    #[test]
    fn classifies_unchanged_local_remote_conflict() {
        let review = build_sync_conflict_review(
            &HashMap::from([
                (
                    "app-state/a.json".into(),
                    br#"{"local":1}"#.to_vec(),
                ),
                (
                    "app-state/shared.json".into(),
                    br#"{"same":true}"#.to_vec(),
                ),
                (
                    "app-state/conflict.json".into(),
                    br#"{"from":"local"}"#.to_vec(),
                ),
            ]),
            &HashMap::from([
                (
                    "app-state/shared.json".into(),
                    br#"{"same":true}"#.to_vec(),
                ),
                (
                    "app-state/b.json".into(),
                    br#"{"remote":1}"#.to_vec(),
                ),
                (
                    "app-state/conflict.json".into(),
                    br#"{"from":"remote"}"#.to_vec(),
                ),
            ]),
        );

        assert_eq!(review.summary.unchanged, 1);
        assert_eq!(review.summary.local_only, 1);
        assert_eq!(review.summary.remote_only, 1);
        assert_eq!(review.summary.conflict, 1);

        let find = |p: &str| review.files.iter().find(|f| f.path == p).unwrap();
        assert_eq!(find("app-state/a.json").kind, SyncFileChangeKind::LocalOnly);
        assert_eq!(find("app-state/b.json").kind, SyncFileChangeKind::RemoteOnly);
        assert_eq!(find("app-state/conflict.json").kind, SyncFileChangeKind::Conflict);
    }

    #[test]
    fn merges_conversation_records_by_id() {
        let merged = merge_file_bytes(
            "app-state/conversations.json",
            br#"{"a":{"title":"A","createdAt":1}}"#,
            br#"{"b":{"title":"B","createdAt":2}}"#,
        );
        let parsed: Value = serde_json::from_slice(&merged).unwrap();
        assert_eq!(
            parsed,
            json!({
                "a": { "title": "A", "createdAt": 1 },
                "b": { "title": "B", "createdAt": 2 }
            })
        );
    }

    #[test]
    fn merges_tasks_by_id_preferring_newer_updated_at() {
        let merged = merge_file_bytes(
            "app-state/tasks.json",
            br#"{"tasks":[{"id":"t1","title":"Local","updatedAt":20}]}"#,
            br#"{"tasks":[{"id":"t1","title":"Remote","updatedAt":10},{"id":"t2","title":"Only remote","updatedAt":5}]}"#,
        );
        let parsed: Value = serde_json::from_slice(&merged).unwrap();
        let tasks = parsed["tasks"].as_array().unwrap();
        let by_id: HashMap<&str, &str> = tasks
            .iter()
            .map(|t| (t["id"].as_str().unwrap(), t["title"].as_str().unwrap()))
            .collect();
        assert_eq!(by_id["t1"], "Local");
        assert_eq!(by_id["t2"], "Only remote");
    }

    #[test]
    fn never_merges_remote_api_keys_in_settings() {
        let merged = merge_file_bytes(
            "settings/settings.json",
            br#"{"version":1,"openai":{"apiKey":"local"},"sync":{"bucket":"local-b"}}"#,
            br#"{"version":1,"openai":{"apiKey":"remote"},"sync":{"bucket":"remote-b"}}"#,
        );
        let parsed: Value = serde_json::from_slice(&merged).unwrap();
        assert!(parsed.get("openai").is_none() || parsed["openai"].get("apiKey").is_none());
        assert_eq!(parsed["sync"]["bucket"], "local-b");
    }

    #[test]
    fn applies_per_file_choices() {
        let local = HashMap::from([
            (
                "app-state/local-only.json".into(),
                br#"{"local":true}"#.to_vec(),
            ),
            (
                "app-state/conflict.json".into(),
                br#"{"from":"local"}"#.to_vec(),
            ),
        ]);
        let remote = HashMap::from([
            (
                "app-state/remote-only.json".into(),
                br#"{"remote":true}"#.to_vec(),
            ),
            (
                "app-state/conflict.json".into(),
                br#"{"from":"remote"}"#.to_vec(),
            ),
        ]);
        let review = build_sync_conflict_review(&local, &remote);
        let mut choices = build_default_merge_choices(&review, &local, &remote);
        choices.insert("app-state/conflict.json".into(), SyncFileChoice::Remote);

        let merged = build_merged_file_map(&local, &remote, &choices);
        assert_eq!(
            String::from_utf8_lossy(merged.get("app-state/local-only.json").unwrap()),
            r#"{"local":true}"#
        );
        assert_eq!(
            String::from_utf8_lossy(merged.get("app-state/remote-only.json").unwrap()),
            r#"{"remote":true}"#
        );
        assert_eq!(
            String::from_utf8_lossy(merged.get("app-state/conflict.json").unwrap()),
            r#"{"from":"remote"}"#
        );
    }

    #[test]
    fn ignores_legacy_plans_json_without_failing() {
        let local = HashMap::from([
            (
                "app-state/tasks.json".into(),
                br#"{"tasks":[]}"#.to_vec(),
            ),
            (
                "app-state/plans.json".into(),
                br#"{"old":true}"#.to_vec(),
            ),
        ]);
        let remote = HashMap::from([
            (
                "app-state/tasks.json".into(),
                br#"{"tasks":[]}"#.to_vec(),
            ),
            (
                "app-state/plans.json".into(),
                br#"{"old":"remote"}"#.to_vec(),
            ),
        ]);
        let review = build_sync_conflict_review(&local, &remote);
        assert!(review.files.iter().all(|f| f.path != "app-state/plans.json"));
        assert_eq!(review.summary.conflict, 0);

        let choices = build_default_merge_choices(&review, &local, &remote);
        let merged = build_merged_file_map(&local, &remote, &choices);
        assert!(!merged.contains_key("app-state/plans.json"));
        assert_eq!(
            String::from_utf8_lossy(merged.get("app-state/tasks.json").unwrap()),
            r#"{"tasks":[]}"#
        );
    }

    #[test]
    fn image_library_merges_per_record_and_keeps_referenced_blobs() {
        let local_index = br#"{
          "images": [
            {"id":"local-img","title":"Local","prompt":"x","createdAt":1,"updatedAt":200,"size":"auto","quality":"auto","background":"auto","outputFormat":"png","fileName":"local-img.png"}
          ]
        }"#;
        let remote_index = br#"{
          "images": [
            {"id":"remote-img","title":"Remote","prompt":"y","createdAt":1,"updatedAt":100,"size":"auto","quality":"auto","background":"auto","outputFormat":"png","fileName":"remote-img.png"}
          ]
        }"#;
        let local = HashMap::from([
            ("app-state/images.json".into(), local_index.to_vec()),
            ("app-state/images/local-img.png".into(), b"local-bytes".to_vec()),
        ]);
        let remote = HashMap::from([
            ("app-state/images.json".into(), remote_index.to_vec()),
            ("app-state/images/remote-img.png".into(), b"remote-bytes".to_vec()),
        ]);

        let review = build_sync_conflict_review(&local, &remote);
        for file in &review.files {
            if file.path.starts_with("app-state/images") {
                assert!(file.supports_merge);
            }
        }

        let choices = build_default_merge_choices(&review, &local, &remote);
        let merged = build_merged_file_map(&local, &remote, &choices);
        let parsed: Value =
            serde_json::from_slice(merged.get("app-state/images.json").unwrap()).unwrap();
        let ids: HashSet<&str> = parsed["images"]
            .as_array()
            .unwrap()
            .iter()
            .map(|img| img["id"].as_str().unwrap())
            .collect();
        assert_eq!(ids, HashSet::from(["local-img", "remote-img"]));
        assert_eq!(
            merged.get("app-state/images/local-img.png").map(|b| b.as_slice()),
            Some(b"local-bytes".as_slice())
        );
        assert_eq!(
            merged
                .get("app-state/images/remote-img.png")
                .map(|b| b.as_slice()),
            Some(b"remote-bytes".as_slice())
        );
    }

    #[test]
    fn image_library_unions_versions_for_same_image_id() {
        let local_index = br#"{
          "images": [
            {"id":"img","title":"Local title","prompt":"","createdAt":1,"updatedAt":50,"size":"auto","quality":"auto","background":"auto","outputFormat":"png","fileName":"a.png","activeVersionId":"v1","versions":[{"id":"v1","fileName":"a.png","createdAt":1,"branch":"A","indexInBranch":1,"kind":"generate","prompt":"","size":"auto","quality":"auto","background":"auto","outputFormat":"png"}]}
          ]
        }"#;
        let remote_index = br#"{
          "images": [
            {"id":"img","title":"Remote title","prompt":"","createdAt":1,"updatedAt":90,"size":"auto","quality":"auto","background":"auto","outputFormat":"png","fileName":"b.png","activeVersionId":"v2","versions":[{"id":"v2","fileName":"b.png","createdAt":2,"branch":"A","indexInBranch":1,"kind":"generate","prompt":"","size":"auto","quality":"auto","background":"auto","outputFormat":"png"}]}
          ]
        }"#;
        let local = HashMap::from([
            ("app-state/images.json".into(), local_index.to_vec()),
            ("app-state/images/a.png".into(), b"a".to_vec()),
        ]);
        let remote = HashMap::from([
            ("app-state/images.json".into(), remote_index.to_vec()),
            ("app-state/images/b.png".into(), b"b".to_vec()),
        ]);
        let review = build_sync_conflict_review(&local, &remote);
        let choices = build_default_merge_choices(&review, &local, &remote);
        let merged = build_merged_file_map(&local, &remote, &choices);
        let parsed: Value =
            serde_json::from_slice(merged.get("app-state/images.json").unwrap()).unwrap();
        let img = &parsed["images"][0];
        assert_eq!(img["title"], "Remote title");
        assert_eq!(img["activeVersionId"], "v2");
        assert_eq!(img["versions"].as_array().unwrap().len(), 2);
        assert!(merged.contains_key("app-state/images/a.png"));
        assert!(merged.contains_key("app-state/images/b.png"));
    }

    #[test]
    fn merges_notes_by_id_and_picks_newer_body() {
        let local_index = br#"{"notes":[{"id":"n1","title":"Local","createdAt":1,"updatedAt":20,"wordCount":1},{"id":"n-local","title":"Only local","createdAt":1,"updatedAt":5,"wordCount":1}]}"#;
        let remote_index = br#"{"notes":[{"id":"n1","title":"Remote","createdAt":1,"updatedAt":10,"wordCount":1},{"id":"n-remote","title":"Only remote","createdAt":1,"updatedAt":6,"wordCount":1}]}"#;
        let local = HashMap::from([
            ("app-state/notes.json".into(), local_index.to_vec()),
            ("app-state/notes/n1.md".into(), b"local body".to_vec()),
            ("app-state/notes/n-local.md".into(), b"local only".to_vec()),
        ]);
        let remote = HashMap::from([
            ("app-state/notes.json".into(), remote_index.to_vec()),
            ("app-state/notes/n1.md".into(), b"remote body".to_vec()),
            ("app-state/notes/n-remote.md".into(), b"remote only".to_vec()),
        ]);
        let review = build_sync_conflict_review(&local, &remote);
        let choices = build_default_merge_choices(&review, &local, &remote);
        let merged = build_merged_file_map(&local, &remote, &choices);
        let parsed: Value =
            serde_json::from_slice(merged.get("app-state/notes.json").unwrap()).unwrap();
        let by_id: HashMap<&str, &str> = parsed["notes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| (n["id"].as_str().unwrap(), n["title"].as_str().unwrap()))
            .collect();
        assert_eq!(by_id["n1"], "Local");
        assert_eq!(by_id["n-local"], "Only local");
        assert_eq!(by_id["n-remote"], "Only remote");
        assert_eq!(
            merged.get("app-state/notes/n1.md").map(|b| b.as_slice()),
            Some(b"local body".as_slice())
        );
        assert!(merged.contains_key("app-state/notes/n-local.md"));
        assert!(merged.contains_key("app-state/notes/n-remote.md"));
    }

    #[test]
    fn emits_canonical_json_for_notes_merge_golden_fixture() {
        const EXPECTED: &str =
            include_str!("../../src/shared/fixtures/syncMerge/notes-merge.expected.json");
        let merged = merge_file_bytes(
            "app-state/notes.json",
            br#"{"notes":[{"id":"n1","title":"Local","updatedAt":20}]}"#,
            br#"{"notes":[{"id":"n1","title":"Remote","updatedAt":10},{"id":"n2","title":"Only remote","updatedAt":5}]}"#,
        );
        assert_eq!(String::from_utf8_lossy(&merged), EXPECTED.trim_end());
    }
}
