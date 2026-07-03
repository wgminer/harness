use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
    "app-state/plans.json",
    "app-state/user_memory.json",
    "settings/settings.json",
];

fn file_bytes_equal(a: &[u8], b: &[u8]) -> bool {
    a == b
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
    if text.len() <= max_len {
        Some(text)
    } else {
        Some(format!("{}…", &text[..max_len]))
    }
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
    match path {
        "app-state/conversations.json" => "Conversation list".into(),
        "app-state/tasks.json" => "Tasks".into(),
        "app-state/plans.json" => "Plans".into(),
        "app-state/user_memory.json" => "User context".into(),
        "app-state/writing.md" => "Writing surface".into(),
        "settings/settings.json" => "App preferences".into(),
        other => other.to_string(),
    }
}

fn supports_merge_for_path(path: &str) -> bool {
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

    SyncConflictReview { files, summary }
}

pub fn build_default_merge_choices(review: &SyncConflictReview) -> HashMap<String, SyncFileChoice> {
    let mut choices = HashMap::new();
    for file in &review.files {
        if file.kind == SyncFileChangeKind::Unchanged {
            choices.insert(file.path.clone(), SyncFileChoice::Local);
        } else {
            choices.insert(file.path.clone(), file.default_choice);
        }
    }
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

fn merge_tasks_json(local: &[u8], remote: &[u8]) -> Vec<u8> {
    let local_state = parse_json(local);
    let remote_state = parse_json(remote);
    let mut by_id: HashMap<String, Value> = HashMap::new();

    if let Some(rows) = remote_state.get("tasks").and_then(|v| v.as_array()) {
        for row in rows {
            if let Some(id) = row.get("id").and_then(|v| v.as_str()) {
                by_id.insert(id.to_string(), row.clone());
            }
        }
    }
    if let Some(rows) = local_state.get("tasks").and_then(|v| v.as_array()) {
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

    let mut tasks: Vec<Value> = by_id.into_values().collect();
    tasks.sort_by(|a, b| ts_from_value(b).cmp(&ts_from_value(a)));
    serde_json::to_vec_pretty(&json!({ "tasks": tasks })).unwrap_or_default()
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
        let stamp = serde_json::to_string(&row).unwrap_or_default();
        if seen.contains(&stamp) {
            continue;
        }
        seen.insert(stamp);
        merged.push(row);
    }
    merged.sort_by_key(|row| ts_from_value(row));
    serde_json::to_vec_pretty(&merged).unwrap_or_default()
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
    serde_json::to_vec_pretty(&merged).unwrap_or_default()
}

pub fn merge_file_bytes(path: &str, local: &[u8], remote: &[u8]) -> Vec<u8> {
    if path == "app-state/tasks.json" {
        return merge_tasks_json(local, remote);
    }
    if path.starts_with("app-state/messages_") {
        return merge_messages_json(local, remote);
    }
    if path == "settings/settings.json" {
        return merge_settings_json(local, remote);
    }
    if path.ends_with(".json") {
        let local_obj = parse_json(local);
        let remote_obj = parse_json(remote);
        if local_obj.is_object() && remote_obj.is_object() {
            return serde_json::to_vec_pretty(&merge_json_records(&local_obj, &remote_obj))
                .unwrap_or_else(|_| local.to_vec());
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

    let mut merged = HashMap::new();
    for path in paths {
        let kind = match (local_files.get(&path), remote_files.get(&path)) {
            (Some(_), Some(_)) => SyncFileChangeKind::Conflict,
            (Some(_), None) => SyncFileChangeKind::LocalOnly,
            (None, Some(_)) => SyncFileChangeKind::RemoteOnly,
            (None, None) => continue,
        };
        let choice = choices
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
    merged
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let mut choices = build_default_merge_choices(&review);
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
}
