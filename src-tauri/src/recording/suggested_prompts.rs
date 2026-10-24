//! Dictation reply-strip action (vocab word or run).
//! Contract: `resources/contracts/dictationSuggestedPrompts.json`.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use futures_util::future::{BoxFuture, FutureExt, Shared};

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

use crate::env_util::is_harness_e2e;
use crate::state::AppState;
use crate::dictation_timing::StepTimer;
use crate::llm::{Completion, ModelTier, Provider};
use crate::openai::OpenAIError;

const CONTRACT_JSON: &str =
    include_str!("../../../resources/contracts/dictationSuggestedPrompts.json");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    system_prompt: String,
    vocabulary: Vec<String>,
    run_action: String,
    max_completion_tokens: u32,
    timeout_secs: u64,
}

fn contract() -> Contract {
    serde_json::from_str(CONTRACT_JSON)
        .expect("resources/contracts/dictationSuggestedPrompts.json must parse")
}

fn build_user_message(transcript: &str) -> String {
    format!(
        "Classify this dictation for a reply-strip action.\n\n<<<TRANSCRIPT>>>\n{}\n<<<END>>>",
        transcript.trim()
    )
}

pub fn clamp_dictation_reply_action(raw: &str) -> String {
    let cfg = contract();
    let run = cfg.run_action.trim().to_ascii_lowercase();
    let run_out = if run.is_empty() {
        "run".to_string()
    } else {
        cfg.run_action.trim().to_string()
    };

    let try_word = |value: &str| -> Option<String> {
        let trimmed = value.split_whitespace().collect::<Vec<_>>().join(" ");
        if trimmed.is_empty() {
            return None;
        }
        if trimmed.eq_ignore_ascii_case(&run_out) {
            return Some(run_out.clone());
        }
        cfg.vocabulary
            .iter()
            .find(|w| w.eq_ignore_ascii_case(&trimmed))
            .cloned()
    };

    if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
        if let Some(action) = parsed.get("action").and_then(|v| v.as_str()) {
            if let Some(w) = try_word(action) {
                return w;
            }
        }
        if let Some(first) = parsed
            .get("prompts")
            .and_then(|v| v.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
        {
            if let Some(w) = try_word(first) {
                return w;
            }
        }
    } else if let Some(w) = try_word(raw.trim()) {
        return w;
    }

    run_out
}

pub fn fallback_dictation_reply_action() -> String {
    let cfg = contract();
    let run = cfg.run_action.trim();
    if run.is_empty() {
        "run".into()
    } else {
        run.to_string()
    }
}

pub async fn classify_dictation_reply_action(
    provider: &Provider,
    transcript: &str,
) -> Result<String, OpenAIError> {
    let cfg = contract();
    let trimmed = transcript.trim();
    if trimmed.is_empty() {
        return Ok(fallback_dictation_reply_action());
    }

    let content = crate::llm::complete(
        provider,
        Completion {
            tier: ModelTier::Small,
            system: &cfg.system_prompt,
            user: &build_user_message(trimmed),
            max_tokens: Some(cfg.max_completion_tokens),
            reasoning_effort: crate::openai::SMALL_MODEL_REASONING_EFFORT,
            json: true,
            timeout: std::time::Duration::from_secs(cfg.timeout_secs),
        },
    )
    .await?;

    Ok(clamp_dictation_reply_action(&content))
}

type SharedAction = Shared<BoxFuture<'static, String>>;

static IN_FLIGHT: Mutex<Option<HashMap<String, SharedAction>>> = Mutex::new(None);

/// Classify at most once at a time per conversation. The run scheduled when a
/// dictation is saved and the chat view's ensure call usually overlap; the
/// second joins the first instead of making its own request.
async fn classify_shared(conversation_id: &str, provider: Provider, transcript: String) -> String {
    let timing_id = conversation_id.to_string();
    join_in_flight(conversation_id, move || async move {
        let timer =
            StepTimer::for_conversation(&timing_id, "Reply action", provider.model(ModelTier::Small));
        match classify_dictation_reply_action(&provider, &transcript).await {
            Ok(a) => {
                timer.ok();
                a
            }
            Err(_) => fallback_dictation_reply_action(),
        }
    })
    .await
}

/// Await the in-flight run for `conversation_id`, or start one with `make`.
async fn join_in_flight<F, Fut>(conversation_id: &str, make: F) -> String
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = String> + Send + 'static,
{
    let shared = {
        let mut guard = IN_FLIGHT.lock().unwrap();
        let map = guard.get_or_insert_with(HashMap::new);
        map.entry(conversation_id.to_string())
            .or_insert_with(|| {
                let conversation_id = conversation_id.to_string();
                let run = make();
                async move {
                    let action = run.await;
                    if let Some(map) = IN_FLIGHT.lock().unwrap().as_mut() {
                        map.remove(&conversation_id);
                    }
                    action
                }
                .boxed()
                .shared()
            })
            .clone()
    };
    shared.await
}

static SUGGEST_GENERATION: Mutex<Option<std::collections::HashMap<String, u64>>> =
    Mutex::new(None);
static SUGGEST_SEQ: AtomicU64 = AtomicU64::new(1);

fn next_suggest_generation(conversation_id: &str) -> u64 {
    let gen = SUGGEST_SEQ.fetch_add(1, Ordering::Relaxed);
    let mut guard = SUGGEST_GENERATION.lock().unwrap();
    let map = guard.get_or_insert_with(std::collections::HashMap::new);
    map.insert(conversation_id.to_string(), gen);
    gen
}

fn is_current_suggest_generation(conversation_id: &str, gen: u64) -> bool {
    let guard = SUGGEST_GENERATION.lock().unwrap();
    guard
        .as_ref()
        .and_then(|m| m.get(conversation_id).copied())
        .map(|current| current == gen)
        .unwrap_or(false)
}

fn emit_action_updated(app: &AppHandle, conversation_id: &str, action: &str) {
    let _ = app.emit(
        "chat-dictation-reply-action-updated",
        serde_json::json!({
            "conversationId": conversation_id,
            "action": action,
        }),
    );
}

/// Schedule classify + persist (no-op in e2e). Skips if meta already has an action.
pub fn schedule_dictation_reply_action(
    app: AppHandle,
    state: AppState,
    conversation_id: String,
) {
    if is_harness_e2e() {
        return;
    }
    let generation = next_suggest_generation(&conversation_id);
    tauri::async_runtime::spawn(async move {
        if let Ok(Some(meta)) =
            crate::memory::get_conversation_meta_for_id(&state, &conversation_id).await
        {
            if meta
                .dictation_reply_action
                .as_deref()
                .map(|s| !s.trim().is_empty())
                .unwrap_or(false)
            {
                return;
            }
        }

        let action = match Provider::active().await {
            Err(_) => fallback_dictation_reply_action(),
            Ok(provider) => {
                let transcript = match crate::memory::get_messages(&state, &conversation_id).await {
                    Ok(msgs) => msgs
                        .iter()
                        .find(|m| m.role == "user")
                        .map(|m| m.content.clone())
                        .unwrap_or_default(),
                    Err(_) => String::new(),
                };
                classify_shared(&conversation_id, provider, transcript).await
            }
        };

        if !is_current_suggest_generation(&conversation_id, generation) {
            return;
        }

        if crate::memory::patch_conversation_dictation_reply_action(
            &state,
            &conversation_id,
            &action,
        )
        .await
        .is_ok()
        {
            emit_action_updated(&app, &conversation_id, &action);
        }
    });
}

/// Ensure action exists (legacy backfill). Returns the action string.
pub async fn ensure_dictation_reply_action(
    app: &AppHandle,
    state: &AppState,
    conversation_id: &str,
) -> Result<String, String> {
    if let Ok(Some(meta)) =
        crate::memory::get_conversation_meta_for_id(state, conversation_id).await
    {
        if let Some(action) = meta.dictation_reply_action {
            let trimmed = action.trim();
            if !trimmed.is_empty() {
                return Ok(clamp_dictation_reply_action(trimmed));
            }
        }
    }

    let transcript = crate::memory::get_messages(state, conversation_id)
        .await
        .map_err(|e| e.to_string())?
        .iter()
        .find(|m| m.role == "user")
        .map(|m| m.content.clone())
        .unwrap_or_default();

    let action = match Provider::active().await {
        Err(_) => fallback_dictation_reply_action(),
        Ok(provider) => classify_shared(conversation_id, provider, transcript).await,
    };

    crate::memory::patch_conversation_dictation_reply_action(state, conversation_id, &action)
        .await
        .map_err(|e| e.to_string())?;
    emit_action_updated(app, conversation_id, &action);
    Ok(action)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn overlapping_classifies_share_one_run() {
        use std::sync::atomic::AtomicUsize;
        use std::sync::Arc;

        let runs = Arc::new(AtomicUsize::new(0));
        let start = |runs: Arc<AtomicUsize>| {
            join_in_flight("conv-shared", move || async move {
                runs.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                "note".to_string()
            })
        };
        let (a, b) = tokio::join!(start(runs.clone()), start(runs.clone()));
        assert_eq!((a.as_str(), b.as_str()), ("note", "note"));
        assert_eq!(runs.load(Ordering::SeqCst), 1);

        // Finished runs are cleared, so a later call classifies again.
        start(runs.clone()).await;
        assert_eq!(runs.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn contract_loads() {
        let cfg = contract();
        assert_eq!(cfg.vocabulary.len(), 4);
        assert!(!cfg.system_prompt.is_empty());
        assert_eq!(cfg.run_action, "run");
    }

    #[test]
    fn clamp_vocab_and_run() {
        assert_eq!(
            clamp_dictation_reply_action(r#"{"action":"Distill"}"#),
            "Distill"
        );
        assert_eq!(clamp_dictation_reply_action(r#"{"action":"run"}"#), "run");
        assert_eq!(
            clamp_dictation_reply_action(r#"{"action":"Continue"}"#),
            "run"
        );
    }
}
