use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::env_util::generate_id;
use crate::memory::{AppState, TASKS_FILE};
use crate::paths::get_app_state_dir;
use crate::storage::{file_exists, write_json_pretty, JsonWriteStyle};

const TASK_STATUSES: [&str; 4] = ["pending", "in_progress", "completed", "cancelled"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::InProgress => "in_progress",
            Self::Completed => "completed",
            Self::Cancelled => "cancelled",
        }
    }
}

impl std::fmt::Display for TaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskItem {
    pub id: String,
    pub title: String,
    pub status: TaskStatus,
    pub tags: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskState {
    pub tasks: Vec<TaskItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksPayload {
    pub tasks: Vec<TaskItem>,
    pub last_action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub affected_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub enum TaskAction {
    List,
    Create { args: Value },
    Update { args: Value },
    Delete { args: Value },
    ClearCompleted,
}

fn tasks_file_path(memory_dir: &Path) -> PathBuf {
    memory_dir.join(TASKS_FILE)
}

pub fn normalize_tags(input: &Value) -> Vec<String> {
    let Some(arr) = input.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for item in arr {
        let t = item
            .as_str()
            .unwrap_or("")
            .trim()
            .to_lowercase()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join("_");
        if t.is_empty() || seen.contains(&t) {
            continue;
        }
        seen.insert(t.clone());
        out.push(t);
    }
    out
}

fn is_task_status(value: &str) -> bool {
    TASK_STATUSES.contains(&value)
}

pub fn normalize_task_status(input: &Value) -> Option<TaskStatus> {
    let s = input.as_str()?.trim().to_lowercase().replace(' ', "_");
    if !is_task_status(&s) {
        return None;
    }
    match s.as_str() {
        "pending" => Some(TaskStatus::Pending),
        "in_progress" => Some(TaskStatus::InProgress),
        "completed" => Some(TaskStatus::Completed),
        "cancelled" => Some(TaskStatus::Cancelled),
        _ => None,
    }
}

fn status_from_tag_list(tags: &[String]) -> Option<TaskStatus> {
    for status in ["completed", "cancelled", "in_progress", "pending"] {
        if tags.iter().any(|t| t == status) {
            return normalize_task_status(&json!(status));
        }
    }
    None
}

fn migrate_task_fields(record: &Value) -> (TaskStatus, Vec<String>) {
    let raw_tags = normalize_tags(record.get("tags").unwrap_or(&json!([])));
    let status_tags: Vec<String> = raw_tags
        .iter()
        .filter(|t| is_task_status(t.as_str()))
        .cloned()
        .collect();
    let label_tags: Vec<String> = raw_tags
        .iter()
        .filter(|t| !is_task_status(t.as_str()))
        .cloned()
        .collect();

    let from_field = record.get("status").and_then(normalize_task_status);
    let from_tags = status_from_tag_list(&status_tags);
    let status = from_tags.or(from_field).unwrap_or(TaskStatus::Pending);
    (status, label_tags)
}

fn task_needs_status_migration(record: &Value) -> bool {
    if record.get("status").and_then(normalize_task_status).is_none() {
        return true;
    }
    normalize_tags(record.get("tags").unwrap_or(&json!([])))
        .iter()
        .any(|t| is_task_status(t.as_str()))
}

fn task_is_clearable(status: TaskStatus) -> bool {
    matches!(status, TaskStatus::Completed | TaskStatus::Cancelled)
}

fn apply_tag_patch(existing: &[String], patch: &Value) -> Option<Vec<String>> {
    let mut next = normalize_tags(&json!(existing));
    let mut changed = false;

    if let Some(replaced) = patch.get("tags").and_then(|v| v.as_array()) {
        let replaced = normalize_tags(&Value::Array(replaced.clone()));
        if replaced != next {
            next = replaced;
            changed = true;
        }
    }
    if let Some(add) = patch.get("add_tags") {
        let mut combined = next.clone();
        combined.extend(normalize_tags(add));
        let merged = normalize_tags(&json!(combined));
        if merged != next {
            next = merged;
            changed = true;
        }
    }
    if let Some(remove) = patch.get("remove_tags") {
        let drop: HashSet<String> = normalize_tags(remove).into_iter().collect();
        if !drop.is_empty() {
            let trimmed: Vec<String> = next.iter().filter(|t| !drop.contains(*t)).cloned().collect();
            let trimmed = normalize_tags(&json!(trimmed));
            if trimmed != next {
                next = trimmed;
                changed = true;
            }
        }
    }

    if changed { Some(next) } else { None }
}

fn migrate_raw_task(raw: &Value) -> Option<TaskItem> {
    let obj = raw.as_object()?;
    let id = obj.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
    let title = obj.get("title").and_then(|v| v.as_str()).unwrap_or("").trim();
    if id.is_empty() || title.is_empty() {
        return None;
    }
    let created_at = obj
        .get("createdAt")
        .and_then(|v| v.as_i64())
        .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
    let updated_at = obj
        .get("updatedAt")
        .and_then(|v| v.as_i64())
        .unwrap_or(created_at);
    let (status, tags) = migrate_task_fields(raw);
    let metadata = obj.get("metadata").cloned().filter(|v| v.is_object());
    Some(TaskItem {
        id: id.to_string(),
        title: title.to_string(),
        status,
        tags,
        created_at,
        updated_at,
        metadata,
    })
}

pub async fn load_tasks_in(state: &AppState, memory_dir: &Path) -> Result<TaskState, std::io::Error> {
    let path = tasks_file_path(memory_dir);
    if !file_exists(&path).await {
        return Ok(TaskState { tasks: vec![] });
    }

    let raw = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    let parsed: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({ "tasks": [] }));
    let rows = if let Some(tasks) = parsed.get("tasks").and_then(|v| v.as_array()) {
        tasks.clone()
    } else if let Some(arr) = parsed.as_array() {
        arr.clone()
    } else {
        vec![]
    };

    let needs_legacy_rewrite = rows.iter().any(|r| task_needs_status_migration(r));
    let tasks: Vec<TaskItem> = rows.iter().filter_map(migrate_raw_task).collect();
    let state_out = TaskState { tasks };

    if needs_legacy_rewrite && !state_out.tasks.is_empty() {
        save_tasks_in(state, memory_dir, &state_out).await?;
    }

    Ok(state_out)
}

async fn load_tasks(state: &AppState) -> Result<TaskState, std::io::Error> {
    load_tasks_in(state, &get_app_state_dir()).await
}

pub async fn save_tasks_in(
    state: &AppState,
    memory_dir: &Path,
    task_state: &TaskState,
) -> Result<(), std::io::Error> {
    let path = tasks_file_path(memory_dir);
    let payload = json!({ "tasks": task_state.tasks });
    write_json_pretty(
        &state.write_chains,
        &path,
        &payload,
        JsonWriteStyle::Canonical,
        r#"{"tasks":[]}"#,
    )
    .await
}

async fn save_tasks(state: &AppState, task_state: &TaskState) -> Result<(), std::io::Error> {
    save_tasks_in(state, &get_app_state_dir(), task_state).await
}

pub fn apply_task_action(state: &TaskState, action: TaskAction, now_ms: i64) -> TasksPayload {
    let mut next_state = TaskState {
        tasks: state.tasks.clone(),
    };

    match action {
        TaskAction::List => {
            return TasksPayload {
                tasks: next_state.tasks,
                last_action: "list".into(),
                affected_ids: None,
                error: None,
            };
        }
        TaskAction::Create { args } => {
            let title = args
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if title.is_empty() {
                return TasksPayload {
                    tasks: next_state.tasks,
                    last_action: "create".into(),
                    affected_ids: None,
                    error: Some("Task title is required".into()),
                };
            }
            let status = args
                .get("status")
                .and_then(normalize_task_status)
                .unwrap_or(TaskStatus::Pending);
            let tags = normalize_tags(args.get("tags").unwrap_or(&json!([])));
            let metadata = args.get("metadata").cloned().filter(|v| v.is_object());
            let task = TaskItem {
                id: generate_id("task"),
                title,
                status,
                tags,
                created_at: now_ms,
                updated_at: now_ms,
                metadata,
            };
            let id = task.id.clone();
            next_state.tasks.push(task);
            return TasksPayload {
                tasks: next_state.tasks,
                last_action: "create".into(),
                affected_ids: Some(vec![id]),
                error: None,
            };
        }
        TaskAction::Update { args } => {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if id.is_empty() {
                return TasksPayload {
                    tasks: next_state.tasks,
                    last_action: "update".into(),
                    affected_ids: None,
                    error: Some("Task id is required".into()),
                };
            }
            let Some(idx) = next_state.tasks.iter().position(|t| t.id == id) else {
                return TasksPayload {
                    tasks: next_state.tasks,
                    last_action: "update".into(),
                    affected_ids: None,
                    error: Some(format!("Task not found: {id}")),
                };
            };
            let mut next = next_state.tasks[idx].clone();
            next.updated_at = now_ms;
            if let Some(title) = args.get("title").and_then(|v| v.as_str()) {
                let trimmed = title.trim();
                if !trimmed.is_empty() {
                    next.title = trimmed.to_string();
                }
            }
            if let Some(status) = args.get("status").and_then(normalize_task_status) {
                next.status = status;
            }
            if let Some(tag_patch) = apply_tag_patch(&next.tags, &args) {
                next.tags = tag_patch;
            }
            if let Some(meta_patch) = args.get("metadata").and_then(|v| v.as_object()) {
                let mut merged = next.metadata.clone().unwrap_or_else(|| json!({}));
                if let Some(obj) = merged.as_object_mut() {
                    for (k, v) in meta_patch {
                        obj.insert(k.clone(), v.clone());
                    }
                }
                next.metadata = Some(merged);
            }
            next_state.tasks[idx] = next;
            return TasksPayload {
                tasks: next_state.tasks,
                last_action: "update".into(),
                affected_ids: Some(vec![id]),
                error: None,
            };
        }
        TaskAction::Delete { args } => {
            let id = args
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            if id.is_empty() {
                return TasksPayload {
                    tasks: next_state.tasks,
                    last_action: "delete".into(),
                    affected_ids: None,
                    error: Some("Task id is required".into()),
                };
            }
            let before = next_state.tasks.len();
            next_state.tasks.retain(|t| t.id != id);
            if next_state.tasks.len() == before {
                return TasksPayload {
                    tasks: next_state.tasks,
                    last_action: "delete".into(),
                    affected_ids: None,
                    error: Some(format!("Task not found: {id}")),
                };
            }
            return TasksPayload {
                tasks: next_state.tasks,
                last_action: "delete".into(),
                affected_ids: Some(vec![id]),
                error: None,
            };
        }
        TaskAction::ClearCompleted => {
            let mut remaining = Vec::new();
            let mut removed_ids = Vec::new();
            for task in next_state.tasks {
                if task_is_clearable(task.status) {
                    removed_ids.push(task.id);
                } else {
                    remaining.push(task);
                }
            }
            next_state.tasks = remaining;
            return TasksPayload {
                tasks: next_state.tasks,
                last_action: "clear_completed".into(),
                affected_ids: Some(removed_ids),
                error: None,
            };
        }
    }
}

pub async fn list_tasks(state: &AppState) -> Result<TasksPayload, std::io::Error> {
    let task_state = load_tasks(state).await?;
    Ok(apply_task_action(&task_state, TaskAction::List, 0))
}

pub async fn create_task(state: &AppState, args: Value) -> Result<TasksPayload, std::io::Error> {
    let task_state = load_tasks(state).await?;
    let now = chrono::Utc::now().timestamp_millis();
    let payload = apply_task_action(&task_state, TaskAction::Create { args }, now);
    if payload.error.is_none() {
        save_tasks(state, &TaskState { tasks: payload.tasks.clone() }).await?;
    }
    Ok(payload)
}

pub async fn update_task(state: &AppState, args: Value) -> Result<TasksPayload, std::io::Error> {
    let task_state = load_tasks(state).await?;
    let now = chrono::Utc::now().timestamp_millis();
    let payload = apply_task_action(&task_state, TaskAction::Update { args }, now);
    if payload.error.is_none() {
        save_tasks(state, &TaskState { tasks: payload.tasks.clone() }).await?;
    }
    Ok(payload)
}

pub async fn delete_task(state: &AppState, args: Value) -> Result<TasksPayload, std::io::Error> {
    let task_state = load_tasks(state).await?;
    let now = chrono::Utc::now().timestamp_millis();
    let payload = apply_task_action(&task_state, TaskAction::Delete { args }, now);
    if payload.error.is_none() {
        save_tasks(state, &TaskState { tasks: payload.tasks.clone() }).await?;
    }
    Ok(payload)
}

pub async fn clear_completed_tasks(state: &AppState) -> Result<TasksPayload, std::io::Error> {
    let task_state = load_tasks(state).await?;
    let now = chrono::Utc::now().timestamp_millis();
    let payload = apply_task_action(&task_state, TaskAction::ClearCompleted, now);
    save_tasks(state, &TaskState { tasks: payload.tasks.clone() }).await?;
    Ok(payload)
}
