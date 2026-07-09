use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::env_util::generate_id;
use crate::memory::{AppState, PLANS_FILE};
use crate::paths::get_app_state_dir;
use crate::storage::{atomic_write_utf8, file_exists, read_json_object_file};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub title: String,
    pub description: String,
    pub conversation_ids: Vec<String>,
    pub created_at: i64,
}

fn plans_path(memory_dir: &Path) -> PathBuf {
    memory_dir.join(PLANS_FILE)
}

pub async fn load_plans_in(
    _state: &AppState,
    memory_dir: &Path,
) -> Result<HashMap<String, Plan>, std::io::Error> {
    let path = plans_path(memory_dir);
    if !file_exists(&path).await {
        return Ok(HashMap::new());
    }
    let parsed = read_json_object_file(&path).await;
    let mut out = HashMap::new();
    if let Some(obj) = parsed.value.as_object() {
        for (id, value) in obj {
            if let Ok(plan) = serde_json::from_value::<Plan>(value.clone()) {
                out.insert(id.clone(), plan);
            }
        }
    }
    Ok(out)
}

async fn load_plans(state: &AppState) -> Result<HashMap<String, Plan>, std::io::Error> {
    load_plans_in(state, &get_app_state_dir()).await
}

pub async fn save_plans_in(
    state: &AppState,
    memory_dir: &Path,
    plans: &HashMap<String, Plan>,
) -> Result<(), std::io::Error> {
    let path = plans_path(memory_dir);
    let value = serde_json::to_value(plans).unwrap_or_else(|_| serde_json::json!({}));
    let pretty = serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".into());
    atomic_write_utf8(&state.write_chains, &path, &pretty).await
}

pub async fn list_plans(state: &AppState) -> Result<Vec<Plan>, std::io::Error> {
    let plans = load_plans(state).await?;
    let mut rows: Vec<Plan> = plans.into_values().collect();
    rows.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(rows)
}

pub async fn create_plan(
    state: &AppState,
    title: &str,
    description: &str,
) -> Result<Plan, std::io::Error> {
    let memory_dir = get_app_state_dir();
    let id = generate_id("plan");
    let plan = Plan {
        id: id.clone(),
        title: title.to_string(),
        description: description.to_string(),
        conversation_ids: vec![],
        created_at: chrono::Utc::now().timestamp_millis(),
    };
    let mut plans = load_plans_in(state, &memory_dir).await?;
    plans.insert(id, plan.clone());
    save_plans_in(state, &memory_dir, &plans).await?;
    Ok(plan)
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanUpdates {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

pub async fn update_plan(
    state: &AppState,
    plan_id: &str,
    updates: PlanUpdates,
) -> Result<Option<Plan>, std::io::Error> {
    let memory_dir = get_app_state_dir();
    let mut plans = load_plans_in(state, &memory_dir).await?;
    let Some(plan) = plans.get_mut(plan_id) else {
        return Ok(None);
    };
    if let Some(title) = updates.title {
        plan.title = title;
    }
    if let Some(description) = updates.description {
        plan.description = description;
    }
    let updated = plan.clone();
    save_plans_in(state, &memory_dir, &plans).await?;
    Ok(Some(updated))
}

pub async fn delete_plan(state: &AppState, plan_id: &str) -> Result<(), std::io::Error> {
    let memory_dir = get_app_state_dir();
    let mut plans = load_plans_in(state, &memory_dir).await?;
    if plans.remove(plan_id).is_some() {
        save_plans_in(state, &memory_dir, &plans).await?;
    }
    Ok(())
}

pub async fn add_conversation_to_plan(
    state: &AppState,
    plan_id: &str,
    conversation_id: &str,
) -> Result<Option<Plan>, std::io::Error> {
    let memory_dir = get_app_state_dir();
    let mut plans = load_plans_in(state, &memory_dir).await?;
    let Some(plan) = plans.get_mut(plan_id) else {
        return Ok(None);
    };
    if !plan.conversation_ids.contains(&conversation_id.to_string()) {
        plan.conversation_ids.push(conversation_id.to_string());
        let updated = plan.clone();
        save_plans_in(state, &memory_dir, &plans).await?;
        return Ok(Some(updated));
    }
    Ok(Some(plan.clone()))
}

pub async fn remove_conversation_from_plan(
    state: &AppState,
    plan_id: &str,
    conversation_id: &str,
) -> Result<Option<Plan>, std::io::Error> {
    let memory_dir = get_app_state_dir();
    let mut plans = load_plans_in(state, &memory_dir).await?;
    let Some(plan) = plans.get_mut(plan_id) else {
        return Ok(None);
    };
    plan.conversation_ids
        .retain(|id| id != conversation_id);
    let updated = plan.clone();
    save_plans_in(state, &memory_dir, &plans).await?;
    Ok(Some(updated))
}
