use regex::Regex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::credentials::resolve_openai_api_key;
use crate::env_util::is_harness_e2e;
use crate::memory::{
    mark_voice_dictation_session, AppState, ConversationTitleSource, MessageRecord,
};
use crate::openai::generate_thread_title_with_openai;

const CONTEXT_MAX_CHARS: usize = 2400;
const REFINE_EVERY: usize = 4;
const FALLBACK_TITLE_MAX_CHARS: usize = 60;

fn clean_title(raw: &str) -> String {
  let re_quotes = Regex::new(r#"["'`]"#).unwrap();
  let collapsed = re_quotes.replace_all(raw, "");
  collapsed.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn is_time_placeholder_title(title: Option<&str>) -> bool {
  let Some(t) = title.map(str::trim).filter(|s| !s.is_empty()) else {
    return true;
  };
  Regex::new(r"^(?:Dictation|New chat|Empty chat) @ ")
    .unwrap()
    .is_match(t)
}

/// Truncate first user message into a short sidebar title when the LLM returns nothing.
pub fn fallback_title_from_messages(messages: &[MessageRecord]) -> Option<String> {
  let first_user = messages.iter().find(|m| m.role == "user")?;
  let cleaned = clean_title(&first_user.content);
  if cleaned.is_empty() {
    return None;
  }
  if cleaned.chars().count() <= FALLBACK_TITLE_MAX_CHARS {
    return Some(cleaned);
  }
  let mut truncated = String::new();
  for word in cleaned.split_whitespace() {
    let next_len = truncated.chars().count() + word.chars().count() + if truncated.is_empty() { 0 } else { 1 };
    if next_len > FALLBACK_TITLE_MAX_CHARS {
      break;
    }
    if !truncated.is_empty() {
      truncated.push(' ');
    }
    truncated.push_str(word);
  }
  if truncated.is_empty() {
    truncated = cleaned.chars().take(FALLBACK_TITLE_MAX_CHARS).collect();
  }
  Some(truncated)
}

pub fn should_refine_conversation_title(messages: &[MessageRecord], title: Option<&str>) -> bool {
  let users = messages.iter().filter(|m| m.role == "user").count();
  let assistants = messages.iter().filter(|m| m.role == "assistant").count();
  if users < 1 {
    return false;
  }
  if assistants == 0 {
    return users == 1 && is_time_placeholder_title(title);
  }
  if assistants == 1 {
    return true;
  }
  users > 1 && users % REFINE_EVERY == 0
}

fn build_context(messages: &[MessageRecord]) -> String {
  let mut parts = Vec::new();
  let mut total = 0usize;
  for m in messages.iter().rev() {
    if total >= CONTEXT_MAX_CHARS {
      break;
    }
    let role = if m.role == "user" { "User" } else { "Assistant" };
    let chunk = format!("{role}: {}", m.content);
    total += chunk.len();
    parts.insert(0, chunk);
  }
  let joined = parts.join("\n\n");
  if joined.len() <= CONTEXT_MAX_CHARS {
    joined
  } else {
    joined[joined.len().saturating_sub(CONTEXT_MAX_CHARS)..].to_string()
  }
}

pub fn emit_conversation_title_updated(app: &AppHandle, conversation_id: &str) {
  let _ = app.emit(
    "chat-conversation-title-updated",
    serde_json::json!({ "conversationId": conversation_id }),
  );
}

pub fn emit_title_generation_started(app: &AppHandle, conversation_id: &str) {
  let _ = app.emit(
    "chat-title-generation-started",
    serde_json::json!({ "conversationId": conversation_id }),
  );
}

pub fn emit_title_generation_ended(app: &AppHandle, conversation_id: &str) {
  let _ = app.emit(
    "chat-title-generation-ended",
    serde_json::json!({ "conversationId": conversation_id }),
  );
}

/// Placeholder dictation title + async LLM refinement (single entry point for voice sessions).
pub async fn finalize_voice_dictation_session(
    app: AppHandle,
    state: &AppState,
    conversation_id: &str,
) -> Result<String, std::io::Error> {
    let title = mark_voice_dictation_session(state, conversation_id).await?;
    schedule_conversation_title_refinement(app, state.clone(), conversation_id.to_string());
    Ok(title)
}

/// Generation counter so a newer refine for the same conversation wins (user then assistant).
static TITLE_REFINE_GENERATION: Mutex<Option<std::collections::HashMap<String, u64>>> =
  Mutex::new(None);
static TITLE_REFINE_SEQ: AtomicU64 = AtomicU64::new(1);

fn next_title_refine_generation(conversation_id: &str) -> u64 {
  let gen = TITLE_REFINE_SEQ.fetch_add(1, Ordering::Relaxed);
  let mut guard = TITLE_REFINE_GENERATION.lock().unwrap();
  let map = guard.get_or_insert_with(std::collections::HashMap::new);
  map.insert(conversation_id.to_string(), gen);
  gen
}

fn is_current_title_refine_generation(conversation_id: &str, gen: u64) -> bool {
  let guard = TITLE_REFINE_GENERATION.lock().unwrap();
  guard
    .as_ref()
    .and_then(|m| m.get(conversation_id).copied())
    .map(|current| current == gen)
    .unwrap_or(false)
}

pub fn schedule_conversation_title_refinement(
  app: AppHandle,
  state: AppState,
  conversation_id: String,
) {
  if is_harness_e2e() {
    return;
  }
  let generation = next_title_refine_generation(&conversation_id);
  tauri::async_runtime::spawn(async move {
    let mut notified_start = false;
    let result: Result<(), String> = async {
      let messages = crate::memory::get_messages(&state, &conversation_id)
        .await
        .map_err(|e| e.to_string())?;
      let meta = crate::memory::get_conversation_meta_for_id(&state, &conversation_id)
        .await
        .map_err(|e| e.to_string())?;
      let Some(meta) = meta else {
        return Ok(());
      };
      if matches!(
        meta.title_source,
        Some(ConversationTitleSource::User) | Some(ConversationTitleSource::Imported)
      ) {
        return Ok(());
      }
      if !should_refine_conversation_title(&messages, meta.title.as_deref()) {
        return Ok(());
      }
      let context = build_context(&messages);
      if context.trim().is_empty() {
        return Ok(());
      }
      let openai_key = resolve_openai_api_key().await.trim().to_string();
      if openai_key.is_empty() {
        // Still give the sidebar something better than "Empty chat @ …".
        if is_time_placeholder_title(meta.title.as_deref()) {
          if let Some(fallback) = fallback_title_from_messages(&messages) {
            if !is_current_title_refine_generation(&conversation_id, generation) {
              return Ok(());
            }
            crate::memory::patch_conversation_auto_title(&state, &conversation_id, &fallback)
              .await
              .map_err(|e| e.to_string())?;
            emit_conversation_title_updated(&app, &conversation_id);
          }
        }
        return Ok(());
      }

      emit_title_generation_started(&app, &conversation_id);
      notified_start = true;

      // Match iOS: don't treat time placeholders as a real previous title.
      let previous_title = meta
        .title
        .as_deref()
        .filter(|t| !t.trim().is_empty() && !is_time_placeholder_title(Some(t)));

      let raw_title = generate_thread_title_with_openai(
        &openai_key,
        previous_title,
        &context,
      )
      .await
      .map_err(|e| e.to_string())?;
      let mut title = clean_title(raw_title.as_deref().unwrap_or(""));
      if title.is_empty() {
        // UNCHANGED / empty model output: keep an existing real title; only fall back
        // when the sidebar would otherwise stay on "Empty chat @ …".
        if !is_time_placeholder_title(meta.title.as_deref()) {
          return Ok(());
        }
        title = fallback_title_from_messages(&messages).unwrap_or_default();
      }
      if title.is_empty() {
        return Ok(());
      }

      if !is_current_title_refine_generation(&conversation_id, generation) {
        return Ok(());
      }

      crate::memory::patch_conversation_auto_title(&state, &conversation_id, &title)
        .await
        .map_err(|e| e.to_string())?;
      emit_conversation_title_updated(&app, &conversation_id);
      Ok(())
    }
    .await;

    if let Err(err) = result {
      eprintln!("[title] LLM title generation failed: {err}");
      // Best-effort local title so new chats don't stay on "Empty chat @ …".
      if is_current_title_refine_generation(&conversation_id, generation) {
        if let Ok(messages) = crate::memory::get_messages(&state, &conversation_id).await {
          if let Ok(Some(meta)) = crate::memory::get_conversation_meta_for_id(&state, &conversation_id).await {
            if is_time_placeholder_title(meta.title.as_deref()) {
              if let Some(fallback) = fallback_title_from_messages(&messages) {
                if crate::memory::patch_conversation_auto_title(&state, &conversation_id, &fallback)
                  .await
                  .is_ok()
                {
                  emit_conversation_title_updated(&app, &conversation_id);
                }
              }
            }
          }
        }
      }
    }
    if notified_start {
      emit_title_generation_ended(&app, &conversation_id);
    }
  });
}

#[cfg(test)]
mod tests {
  use super::*;

  fn msg(role: &str, content: &str) -> MessageRecord {
    MessageRecord {
      role: role.into(),
      content: content.into(),
      tool_calls: None,
      timestamp: None,
      model: None,
      attachments: None,
    }
  }

  #[test]
  fn fallback_title_truncates_long_user_message() {
    let long = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda";
    let title = fallback_title_from_messages(&[msg("user", long)]).unwrap();
    assert!(title.chars().count() <= FALLBACK_TITLE_MAX_CHARS);
    assert!(title.starts_with("alpha"));
    assert!(!title.contains('"'));
  }

  #[test]
  fn fallback_title_uses_first_user_message() {
    let title = fallback_title_from_messages(&[
      msg("user", "Buy milk and eggs"),
      msg("assistant", "Sure"),
    ])
    .unwrap();
    assert_eq!(title, "Buy milk and eggs");
  }

  #[test]
  fn should_refine_on_first_user_only_placeholder() {
    assert!(should_refine_conversation_title(
      &[msg("user", "hello")],
      None
    ));
  }
}
