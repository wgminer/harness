use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::env_util::generate_id;
use crate::state::AppState;
use crate::memory::TASKS_FILE;
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
    /// Subtask parent (one level deep, like Todoist `parent_id`). Missing parent => top level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// Eisenhower "important" axis. Urgency is derived from `due_date`, never stored.
    #[serde(default, skip_serializing_if = "is_false")]
    pub important: bool,
    /// Local calendar day, `YYYY-MM-DD`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub due_date: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub estimate_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

fn is_false(value: &bool) -> bool {
    !*value
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

/// Non-empty `parentId` from an args or row object.
fn parent_id_arg(args: &Value) -> Option<String> {
    args.get("parentId")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// A `YYYY-MM-DD` calendar day, or `None` when the value is not a real date.
fn parse_due_date(value: &Value) -> Option<String> {
    let s = value.as_str()?.trim();
    chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .ok()
        .map(|d| d.format("%Y-%m-%d").to_string())
}

/// Null or an empty string clears an optional field.
fn is_clear(value: &Value) -> bool {
    value.is_null() || value.as_str().is_some_and(|s| s.trim().is_empty())
}

/// Whole minutes above zero.
fn parse_estimate_minutes(value: &Value) -> Option<u32> {
    let n = value.as_f64()?.round();
    (n >= 1.0 && n <= u32::MAX as f64).then_some(n as u32)
}

const DUE_DATE_ERROR: &str = "dueDate must be a calendar day like 2026-03-14";

/// Subtasks nest one level: a parent must exist and must not itself be a subtask.
fn valid_parent(tasks: &[TaskItem], parent_id: &str, child_id: Option<&str>) -> bool {
    child_id != Some(parent_id)
        && tasks
            .iter()
            .any(|t| t.id == parent_id && t.parent_id.is_none())
        && child_id.is_none_or(|id| !tasks.iter().any(|t| t.parent_id.as_deref() == Some(id)))
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
    let parent_id = parent_id_arg(raw);
    Some(TaskItem {
        id: id.to_string(),
        title: title.to_string(),
        status,
        tags,
        created_at,
        updated_at,
        parent_id,
        important: obj.get("important").and_then(|v| v.as_bool()).unwrap_or(false),
        due_date: obj.get("dueDate").and_then(parse_due_date),
        estimate_minutes: obj.get("estimateMinutes").and_then(parse_estimate_minutes),
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
            let parent_id = match parent_id_arg(&args) {
                Some(pid) if !valid_parent(&next_state.tasks, &pid, None) => {
                    return TasksPayload {
                        tasks: next_state.tasks,
                        last_action: "create".into(),
                        affected_ids: None,
                        error: Some(format!("Parent task not found or is itself a subtask: {pid}")),
                    };
                }
                other => other,
            };
            let due_date = match args.get("dueDate") {
                Some(raw) if !is_clear(raw) => match parse_due_date(raw) {
                    Some(day) => Some(day),
                    None => {
                        return TasksPayload {
                            tasks: next_state.tasks,
                            last_action: "create".into(),
                            affected_ids: None,
                            error: Some(DUE_DATE_ERROR.into()),
                        };
                    }
                },
                _ => None,
            };
            let task = TaskItem {
                id: generate_id("task"),
                title,
                status,
                tags,
                created_at: now_ms,
                updated_at: now_ms,
                parent_id,
                important: args.get("important").and_then(|v| v.as_bool()).unwrap_or(false),
                due_date,
                estimate_minutes: args.get("estimateMinutes").and_then(parse_estimate_minutes),
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
            // `parentId`: a task id nests it, "" or null moves it back to the top level.
            if let Some(raw_parent) = args.get("parentId") {
                match parent_id_arg(&args) {
                    Some(pid) if valid_parent(&next_state.tasks, &pid, Some(&next.id)) => {
                        next.parent_id = Some(pid);
                    }
                    Some(pid) => {
                        return TasksPayload {
                            tasks: next_state.tasks,
                            last_action: "update".into(),
                            affected_ids: None,
                            error: Some(format!("Cannot nest under task: {pid}")),
                        };
                    }
                    None if raw_parent.is_null() || raw_parent.as_str().is_some() => {
                        next.parent_id = None;
                    }
                    None => {}
                }
            }
            if let Some(important) = args.get("important").and_then(|v| v.as_bool()) {
                next.important = important;
            }
            // `dueDate`: a day sets it, "" or null clears it.
            if let Some(raw) = args.get("dueDate") {
                if is_clear(raw) {
                    next.due_date = None;
                } else if let Some(day) = parse_due_date(raw) {
                    next.due_date = Some(day);
                } else {
                    return TasksPayload {
                        tasks: next_state.tasks,
                        last_action: "update".into(),
                        affected_ids: None,
                        error: Some(DUE_DATE_ERROR.into()),
                    };
                }
            }
            // `estimateMinutes`: a positive number sets it, 0 or null clears it.
            if let Some(raw) = args.get("estimateMinutes") {
                if raw.is_null() || raw.as_f64() == Some(0.0) {
                    next.estimate_minutes = None;
                } else if let Some(minutes) = parse_estimate_minutes(raw) {
                    next.estimate_minutes = Some(minutes);
                }
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
            // Deleting a parent deletes its subtasks (Todoist does the same).
            next_state
                .tasks
                .retain(|t| t.id != id && t.parent_id.as_deref() != Some(id.as_str()));
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
            // Open subtasks of a cleared parent stay, promoted to the top level.
            for task in &mut remaining {
                if task
                    .parent_id
                    .as_ref()
                    .is_some_and(|pid| removed_ids.contains(pid))
                {
                    task.parent_id = None;
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

const BREAKDOWN_SYSTEM: &str = "You break a to-do item into the concrete next steps needed to finish it. \
Return JSON: {\"subtasks\": [\"...\"]}. Give 2 to 6 short, imperative steps in order, \
each a single action someone could start right away. No numbering, no restating the task, \
no generic steps like \"plan\" or \"review\" unless they are real work.";

/// Parse `{"subtasks": [..]}` into trimmed, non-empty titles (max 8).
pub fn parse_breakdown_titles(raw: &str) -> Vec<String> {
    let parsed: Value = serde_json::from_str(raw).unwrap_or(Value::Null);
    parsed
        .get("subtasks")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.trim().trim_start_matches(['-', '*', ' ']).trim().to_string())
                .filter(|s| !s.is_empty())
                .take(8)
                .collect()
        })
        .unwrap_or_default()
}

/// Ask the model for subtasks of `id` and save them as its children.
pub async fn breakdown_task(state: &AppState, id: &str) -> Result<TasksPayload, String> {
    let task_state = load_tasks(state).await.map_err(|e| e.to_string())?;
    let Some(task) = task_state.tasks.iter().find(|t| t.id == id).cloned() else {
        return Err(format!("Task not found: {id}"));
    };
    if task.parent_id.is_some() {
        return Err("Subtasks cannot be broken down further.".into());
    }
    let api_key = crate::credentials::resolve_openai_api_key().await.trim().to_string();
    if api_key.is_empty() {
        return Err("OpenAI API key required.".into());
    }
    let existing: Vec<&str> = task_state
        .tasks
        .iter()
        .filter(|t| t.parent_id.as_deref() == Some(id))
        .map(|t| t.title.as_str())
        .collect();
    let mut user = format!("Task: {}", task.title);
    if !existing.is_empty() {
        user.push_str(&format!(
            "\n\nExisting subtasks (do not repeat these):\n- {}",
            existing.join("\n- ")
        ));
    }
    let raw = crate::openai::chat_completion_json(
        &api_key,
        crate::openai::openai_chat_model().as_str(),
        BREAKDOWN_SYSTEM,
        &user,
        2500,
        crate::openai::CHAT_REASONING_EFFORT,
        45,
    )
    .await
    .map_err(|e| e.to_string())?;
    let titles = parse_breakdown_titles(&raw);
    if titles.is_empty() {
        return Err("Could not break this task down.".into());
    }

    // Reload so edits made while the model was thinking are not lost.
    let mut next = load_tasks(state).await.map_err(|e| e.to_string())?;
    if !next.tasks.iter().any(|t| t.id == id) {
        return Err(format!("Task not found: {id}"));
    }
    let now = chrono::Utc::now().timestamp_millis();
    let mut created = Vec::new();
    for (i, title) in titles.into_iter().enumerate() {
        let child = TaskItem {
            id: generate_id("task"),
            title,
            status: TaskStatus::Pending,
            tags: Vec::new(),
            // Offset so creation order is stable for sorting.
            created_at: now + i as i64,
            updated_at: now + i as i64,
            parent_id: Some(id.to_string()),
            important: false,
            due_date: None,
            estimate_minutes: None,
            metadata: None,
        };
        created.push(child.id.clone());
        next.tasks.push(child);
    }
    save_tasks(state, &next).await.map_err(|e| e.to_string())?;
    Ok(TasksPayload {
        tasks: next.tasks,
        last_action: "breakdown".into(),
        affected_ids: Some(created),
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create(state: &TaskState, args: Value) -> TaskState {
        let payload = apply_task_action(state, TaskAction::Create { args }, 1);
        assert!(payload.error.is_none(), "{:?}", payload.error);
        TaskState { tasks: payload.tasks }
    }

    fn with_parent_and_child() -> (TaskState, String, String) {
        let state = create(&TaskState { tasks: vec![] }, json!({ "title": "Parent" }));
        let parent = state.tasks[0].id.clone();
        let state = create(&state, json!({ "title": "Child", "parentId": parent }));
        let child = state.tasks[1].id.clone();
        (state, parent, child)
    }

    #[test]
    fn subtasks_nest_one_level() {
        let (state, _, child) = with_parent_and_child();
        let payload = apply_task_action(
            &state,
            TaskAction::Create { args: json!({ "title": "Grandchild", "parentId": child }) },
            2,
        );
        assert!(payload.error.is_some());
    }

    #[test]
    fn parent_with_children_cannot_be_nested() {
        let (state, parent, _) = with_parent_and_child();
        let state = create(&state, json!({ "title": "Other" }));
        let other = state.tasks[2].id.clone();
        let payload = apply_task_action(
            &state,
            TaskAction::Update { args: json!({ "id": parent, "parentId": other }) },
            2,
        );
        assert!(payload.error.is_some());
    }

    #[test]
    fn update_can_clear_parent() {
        let (state, _, child) = with_parent_and_child();
        let payload = apply_task_action(
            &state,
            TaskAction::Update { args: json!({ "id": child, "parentId": null }) },
            2,
        );
        assert!(payload.tasks.iter().all(|t| t.parent_id.is_none()));
    }

    #[test]
    fn deleting_parent_deletes_subtasks() {
        let (state, parent, _) = with_parent_and_child();
        let payload = apply_task_action(&state, TaskAction::Delete { args: json!({ "id": parent }) }, 2);
        assert!(payload.tasks.is_empty());
    }

    #[test]
    fn clearing_completed_parent_promotes_open_subtasks() {
        let (state, parent, child) = with_parent_and_child();
        let state = TaskState {
            tasks: apply_task_action(
                &state,
                TaskAction::Update { args: json!({ "id": parent, "status": "completed" }) },
                2,
            )
            .tasks,
        };
        let payload = apply_task_action(&state, TaskAction::ClearCompleted, 3);
        assert_eq!(payload.tasks.len(), 1);
        assert_eq!(payload.tasks[0].id, child);
        assert!(payload.tasks[0].parent_id.is_none());
    }

    #[test]
    fn parent_id_round_trips_through_storage_shape() {
        let (state, parent, _) = with_parent_and_child();
        let raw = serde_json::to_value(&state.tasks[1]).unwrap();
        assert_eq!(raw["parentId"], json!(parent));
        assert!(serde_json::to_value(&state.tasks[0]).unwrap().get("parentId").is_none());
        assert_eq!(migrate_raw_task(&raw).unwrap().parent_id.as_deref(), Some(parent.as_str()));
    }

    #[test]
    fn create_sets_matrix_fields_and_omits_unset_ones() {
        let state = create(
            &TaskState { tasks: vec![] },
            json!({ "title": "Taxes", "important": true, "dueDate": "2026-04-15", "estimateMinutes": 90 }),
        );
        let raw = serde_json::to_value(&state.tasks[0]).unwrap();
        assert_eq!(raw["important"], json!(true));
        assert_eq!(raw["dueDate"], json!("2026-04-15"));
        assert_eq!(raw["estimateMinutes"], json!(90));
        let round_trip = migrate_raw_task(&raw).unwrap();
        assert!(round_trip.important);
        assert_eq!(round_trip.due_date.as_deref(), Some("2026-04-15"));
        assert_eq!(round_trip.estimate_minutes, Some(90));

        let plain = create(&TaskState { tasks: vec![] }, json!({ "title": "Plain" }));
        let raw = serde_json::to_value(&plain.tasks[0]).unwrap();
        for key in ["important", "dueDate", "estimateMinutes"] {
            assert!(raw.get(key).is_none(), "{key} should be omitted");
        }
    }

    #[test]
    fn update_sets_and_clears_matrix_fields() {
        let state = create(
            &TaskState { tasks: vec![] },
            json!({ "title": "Taxes", "important": true, "dueDate": "2026-04-15", "estimateMinutes": 90 }),
        );
        let id = state.tasks[0].id.clone();
        let payload = apply_task_action(
            &state,
            TaskAction::Update {
                args: json!({ "id": id, "important": false, "dueDate": null, "estimateMinutes": 0 }),
            },
            2,
        );
        assert!(payload.error.is_none());
        let task = &payload.tasks[0];
        assert!(!task.important);
        assert!(task.due_date.is_none());
        assert!(task.estimate_minutes.is_none());

        // An update that does not mention the fields leaves them alone.
        let payload = apply_task_action(
            &state,
            TaskAction::Update { args: json!({ "id": id, "title": "File taxes" }) },
            3,
        );
        assert!(payload.tasks[0].important);
        assert_eq!(payload.tasks[0].due_date.as_deref(), Some("2026-04-15"));
    }

    #[test]
    fn rejects_due_dates_that_are_not_calendar_days() {
        let empty = TaskState { tasks: vec![] };
        for bad in ["tomorrow", "2026-02-30", "04/15/2026"] {
            let payload = apply_task_action(
                &empty,
                TaskAction::Create { args: json!({ "title": "T", "dueDate": bad }) },
                1,
            );
            assert!(payload.error.is_some(), "{bad} should be rejected");
        }
    }

    #[test]
    fn parses_breakdown_titles() {
        let titles = parse_breakdown_titles(r#"{"subtasks": [" - Call Sam ", "", "Book flight"]}"#);
        assert_eq!(titles, vec!["Call Sam", "Book flight"]);
        assert!(parse_breakdown_titles("not json").is_empty());
    }
}
