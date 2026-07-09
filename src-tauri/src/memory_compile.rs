use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::credentials::resolve_openai_api_key;
use crate::memory::{get_memory_dir, load_conversations_in, load_messages_in, AppState};
use crate::openai::{chat_completion_json, openai_transcript_cleanup_model};
use crate::storage::{atomic_write_utf8, file_exists};

const STATE_FILE: &str = "memory_compile_state.json";
const FIRST_RUN_LOOKBACK_MS: i64 = 24 * 60 * 60 * 1000;
pub const MEMORY_COMPILE_CHAR_BUDGET: usize = 24_000;
pub const MEMORY_COMPILE_MAX_CONVERSATIONS: usize = 30;
const RIG_PAGE_TITLE: &str = "System";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryCompileState {
    pub last_run_at: Option<i64>,
    pub last_run_date_local: Option<String>,
    pub last_added_count: i64,
    pub last_updated_count: i64,
    pub last_considered_count: i64,
    pub last_error: Option<String>,
}

pub const EMPTY_COMPILE_STATE: MemoryCompileState = MemoryCompileState {
    last_run_at: None,
    last_run_date_local: None,
    last_added_count: 0,
    last_updated_count: 0,
    last_considered_count: 0,
    last_error: None,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DistilledFact {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub ran_at: i64,
    pub considered: usize,
    pub added: usize,
    pub updated: usize,
    pub skipped: bool,
    pub skip_reason: Option<&'static str>,
}

#[async_trait::async_trait]
pub trait MemoryCompileLlm: Send + Sync {
    async fn distill(&self, transcripts: &str) -> Result<Vec<DistilledFact>, String>;
}

struct OpenAiDistiller {
    api_key: String,
}

#[async_trait::async_trait]
impl MemoryCompileLlm for OpenAiDistiller {
    async fn distill(&self, transcripts: &str) -> Result<Vec<DistilledFact>, String> {
        let system = [
            "You are a memory distiller for a personal LLM workspace.",
            "From the user-message transcripts below, extract durable, stable facts the user expressed about themselves.",
            "Include only things that will remain true for weeks or months: location/timezone, ongoing projects, tools and stack they use, preferences, recurring people they work with, professional role, equipment.",
            "DO NOT include: single-task asks, ephemeral state (today's mood, transient errors), assistant suggestions the user did not commit to, or sensitive personal information beyond what the user clearly stated.",
            "Output strict JSON with this exact shape and nothing else:",
            "{ \"facts\": [ { \"key\": \"snake_case_label\", \"value\": \"one-line detail\" } ] }",
            "Keys must be short lowercase snake_case (max 40 chars). Values must fit on one line (max 200 chars).",
            "If nothing durable surfaces, output { \"facts\": [] }.",
        ]
        .join("\n");

        let raw = chat_completion_json(
            &self.api_key,
            &openai_transcript_cleanup_model(),
            &system,
            transcripts,
            1500,
            60,
        )
        .await
        .map_err(|e| e.to_string())?;
        Ok(parse_facts_response(&raw))
    }
}

struct ConversationSlice {
    id: String,
    created_at: i64,
    title: Option<String>,
    newest_message_at: i64,
    user_text: String,
}

fn get_state_path(memory_dir: &Path) -> PathBuf {
    memory_dir.join(STATE_FILE)
}

pub async fn load_compile_state_in(memory_dir: &Path) -> MemoryCompileState {
    let path = get_state_path(memory_dir);
    if !file_exists(&path).await {
        return MemoryCompileState {
            last_run_at: None,
            last_run_date_local: None,
            last_added_count: 0,
            last_updated_count: 0,
            last_considered_count: 0,
            last_error: None,
        };
    }
    let raw = tokio::fs::read_to_string(&path).await.unwrap_or_default();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({}));
    MemoryCompileState {
        last_run_at: parsed.get("lastRunAt").and_then(|v| v.as_i64()),
        last_run_date_local: parsed
            .get("lastRunDateLocal")
            .and_then(|v| v.as_str())
            .map(str::to_string),
        last_added_count: parsed
            .get("lastAddedCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        last_updated_count: parsed
            .get("lastUpdatedCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        last_considered_count: parsed
            .get("lastConsideredCount")
            .and_then(|v| v.as_i64())
            .unwrap_or(0),
        last_error: parsed
            .get("lastError")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    }
}

pub async fn save_compile_state_in(
    state: &AppState,
    memory_dir: &Path,
    compile_state: &MemoryCompileState,
) -> Result<(), std::io::Error> {
    let pretty = serde_json::to_string_pretty(compile_state).unwrap_or_else(|_| "{}".into());
    atomic_write_utf8(&state.write_chains, &get_state_path(memory_dir), &pretty).await
}

pub fn local_date_string(now: chrono::DateTime<chrono::Local>) -> String {
    now.format("%Y-%m-%d").to_string()
}

pub fn is_compile_due(state: &MemoryCompileState, now: chrono::DateTime<chrono::Local>) -> bool {
    match &state.last_run_date_local {
        None => true,
        Some(last) => last != &local_date_string(now),
    }
}

fn pick_window_start(state: &MemoryCompileState, now_ms: i64) -> i64 {
    if let Some(last) = state.last_run_at {
        if last > 0 {
            return last;
        }
    }
    now_ms - FIRST_RUN_LOOKBACK_MS
}

async fn collect_slices_since(
    state: &AppState,
    memory_dir: &Path,
    since: i64,
) -> Vec<ConversationSlice> {
    let conv = load_conversations_in(state, memory_dir).await;
    let mut out = Vec::new();
    for (id, meta) in conv {
        let messages = load_messages_in(state, memory_dir, &id).await;
        if messages.is_empty() {
            continue;
        }
        let mut newest_message_timestamp = i64::MIN;
        let mut has_any_timestamp = false;
        let mut user_parts = Vec::new();
        for m in &messages {
            if let Some(ts) = m.timestamp {
                has_any_timestamp = true;
                if ts > newest_message_timestamp {
                    newest_message_timestamp = ts;
                }
            }
            if m.role == "user" && !m.content.trim().is_empty() {
                user_parts.push(m.content.trim().to_string());
            }
        }
        let newest_at = if has_any_timestamp {
            newest_message_timestamp
        } else {
            meta.created_at
        };
        if newest_at < since || user_parts.is_empty() {
            continue;
        }
        out.push(ConversationSlice {
            id,
            created_at: meta.created_at,
            title: meta.title,
            newest_message_at: newest_at,
            user_text: user_parts.join("\n\n"),
        });
    }
    out.sort_by(|a, b| b.newest_message_at.cmp(&a.newest_message_at));
    out
}

fn build_transcript(slices: &[ConversationSlice]) -> (String, Vec<ConversationSlice>) {
    let mut included = Vec::new();
    let mut blocks = Vec::new();
    let mut used = 0usize;
    for s in slices {
        if included.len() >= MEMORY_COMPILE_MAX_CONVERSATIONS {
            break;
        }
        let header = format!(
            "--- Conversation {}{} ---",
            included.len() + 1,
            s.title
                .as_ref()
                .map(|t| format!(": {t}"))
                .unwrap_or_default()
        );
        let body = &s.user_text;
        let cost = header.len() + body.len() + 2;
        if used + cost > MEMORY_COMPILE_CHAR_BUDGET && !included.is_empty() {
            break;
        }
        blocks.push(format!("{header}\n{body}"));
        included.push(ConversationSlice {
            id: s.id.clone(),
            created_at: s.created_at,
            title: s.title.clone(),
            newest_message_at: s.newest_message_at,
            user_text: s.user_text.clone(),
        });
        used += cost;
    }
    (blocks.join("\n\n"), included)
}

pub fn merge_facts(
    existing: &HashMap<String, String>,
    facts: &[DistilledFact],
) -> (HashMap<String, String>, usize, usize) {
    let mut merged = existing.clone();
    let mut lower_to_key = HashMap::new();
    for k in merged.keys() {
        lower_to_key.insert(k.to_lowercase(), k.clone());
    }

    let mut added = 0usize;
    let mut updated = 0usize;
    let mut seen_lower_keys = HashSet::new();

    for fact in facts {
        let raw_key = fact.key.trim();
        let raw_value = fact.value.trim();
        if raw_key.is_empty() || raw_value.is_empty() {
            continue;
        }
        let lower = raw_key.to_lowercase();
        if seen_lower_keys.contains(&lower) {
            continue;
        }
        seen_lower_keys.insert(lower.clone());

        if let Some(existing_key) = lower_to_key.get(&lower) {
            if merged.get(existing_key).map(|v| v.trim()) != Some(raw_value) {
                merged.insert(existing_key.clone(), raw_value.to_string());
                updated += 1;
            }
        } else {
            merged.insert(raw_key.to_string(), raw_value.to_string());
            lower_to_key.insert(lower, raw_key.to_string());
            added += 1;
        }
    }

    (merged, added, updated)
}

pub fn parse_facts_response(raw: &str) -> Vec<DistilledFact> {
    if raw.trim().is_empty() {
        return Vec::new();
    }
    let mut trimmed = raw.trim().to_string();
    if let Some(stripped) = trimmed.strip_prefix("```json") {
        trimmed = stripped.trim().to_string();
    } else if let Some(stripped) = trimmed.strip_prefix("```") {
        trimmed = stripped.trim().to_string();
    }
    if let Some(stripped) = trimmed.strip_suffix("```") {
        trimmed = stripped.trim().to_string();
    }

    let parsed: serde_json::Value = match serde_json::from_str(&trimmed) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let facts = parsed
        .get("facts")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for f in facts {
        let key = f.get("key").and_then(|v| v.as_str());
        let value = f.get("value").and_then(|v| v.as_str());
        if let (Some(key), Some(value)) = (key, value) {
            out.push(DistilledFact {
                key: key.to_string(),
                value: value.to_string(),
            });
        }
    }
    out
}

pub fn create_openai_distiller(api_key: impl Into<String>) -> Box<dyn MemoryCompileLlm> {
    Box::new(OpenAiDistiller {
        api_key: api_key.into(),
    })
}

pub async fn compile_memories_in(
    state: &AppState,
    memory_dir: &Path,
    llm: &dyn MemoryCompileLlm,
    now: chrono::DateTime<chrono::Local>,
) -> Result<CompileResult, String> {
    let compile_state = load_compile_state_in(memory_dir).await;
    let since = pick_window_start(&compile_state, now.timestamp_millis());
    let slices = collect_slices_since(state, memory_dir, since).await;

    let save_skipped = |reason: &'static str| async {
        let next = MemoryCompileState {
            last_run_at: Some(now.timestamp_millis()),
            last_run_date_local: Some(local_date_string(now)),
            last_added_count: 0,
            last_updated_count: 0,
            last_considered_count: 0,
            last_error: None,
            ..MemoryCompileState {
                last_run_at: None,
                last_run_date_local: None,
                last_added_count: 0,
                last_updated_count: 0,
                last_considered_count: 0,
                last_error: None,
            }
        };
        save_compile_state_in(state, memory_dir, &next)
            .await
            .map_err(|e| e.to_string())?;
        Ok(CompileResult {
            ran_at: now.timestamp_millis(),
            considered: 0,
            added: 0,
            updated: 0,
            skipped: true,
            skip_reason: Some(reason),
        })
    };

    if slices.is_empty() {
        return save_skipped("no-conversations").await;
    }

    let (transcript, included) = build_transcript(&slices);
    if transcript.is_empty() {
        return save_skipped("empty-transcript").await;
    }

    let facts = llm.distill(&transcript).await?;
    let existing = crate::memory::get_user_memory_in(state, memory_dir)
        .await
        .map_err(|e| e.to_string())?;
    let (merged, added, updated) = merge_facts(&existing, &facts);
    for (key, value) in &merged {
        if existing.get(key) != Some(value) {
            crate::memory::set_user_memory_in(state, memory_dir, key, value)
                .await
                .map_err(|e| e.to_string())?;
        }
    }

    let next = MemoryCompileState {
        last_run_at: Some(now.timestamp_millis()),
        last_run_date_local: Some(local_date_string(now)),
        last_added_count: added as i64,
        last_updated_count: updated as i64,
        last_considered_count: included.len() as i64,
        last_error: None,
    };
    save_compile_state_in(state, memory_dir, &next)
        .await
        .map_err(|e| e.to_string())?;

    Ok(CompileResult {
        ran_at: now.timestamp_millis(),
        considered: included.len(),
        added,
        updated,
        skipped: false,
        skip_reason: None,
    })
}

async fn record_compile_error(state: &AppState, memory_dir: &Path, message: &str) {
    let compile_state = load_compile_state_in(memory_dir).await;
    let next = MemoryCompileState {
        last_error: Some(message.to_string()),
        ..compile_state
    };
    let _ = save_compile_state_in(state, memory_dir, &next).await;
}

async fn build_llm_from_settings() -> Option<Box<dyn MemoryCompileLlm>> {
    let api_key = resolve_openai_api_key().await.trim().to_string();
    if api_key.is_empty() {
        return None;
    }
    Some(create_openai_distiller(api_key))
}

pub async fn run_memory_compile_if_due(
    state: &AppState,
) -> Result<Result<CompileResult, &'static str>, std::io::Error> {
    let memory_dir = get_memory_dir();
    let compile_state = load_compile_state_in(&memory_dir).await;
    let now = chrono::Local::now();
    if !is_compile_due(&compile_state, now) {
        return Ok(Err("not-due"));
    }
    let Some(llm) = build_llm_from_settings().await else {
        return Ok(Err("no-api-key"));
    };
    match compile_memories_in(state, &memory_dir, llm.as_ref(), now).await {
        Ok(result) => Ok(Ok(result)),
        Err(message) => {
            record_compile_error(state, &memory_dir, &message).await;
            Ok(Ok(CompileResult {
                ran_at: now.timestamp_millis(),
                considered: 0,
                added: 0,
                updated: 0,
                skipped: true,
                skip_reason: None,
            }))
        }
    }
}

pub async fn run_memory_compile_now(
    state: &AppState,
) -> Result<Result<CompileResult, String>, std::io::Error> {
    let memory_dir = get_memory_dir();
    let Some(llm) = build_llm_from_settings().await else {
        return Ok(Err(format!(
            "Add an OpenAI API key in {RIG_PAGE_TITLE} before compiling context."
        )));
    };
    let now = chrono::Local::now();
    match compile_memories_in(state, &memory_dir, llm.as_ref(), now).await {
        Ok(result) => Ok(Ok(result)),
        Err(message) => {
            record_compile_error(state, &memory_dir, &message).await;
            Ok(Err(message))
        }
    }
}

pub async fn get_memory_compile_status(_state: &AppState) -> MemoryCompileState {
    load_compile_state_in(&get_memory_dir()).await
}
