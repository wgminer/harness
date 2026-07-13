use regex::Regex;
use tauri::{AppHandle, Emitter};

use crate::credentials::resolve_openai_api_key;
use crate::env_util::is_harness_e2e;
use crate::memory::{
    mark_voice_dictation_session, AppState, ConversationTitleSource, MessageRecord,
};
use crate::openai::generate_thread_title_with_openai;

const CONTEXT_MAX_CHARS: usize = 2400;
const REFINE_EVERY: usize = 4;

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

pub fn schedule_conversation_title_refinement(
  app: AppHandle,
  state: AppState,
  conversation_id: String,
) {
  if is_harness_e2e() {
    return;
  }
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
        return Ok(());
      }

      emit_title_generation_started(&app, &conversation_id);
      notified_start = true;

      let raw_title = generate_thread_title_with_openai(
        &openai_key,
        meta.title.as_deref(),
        &context,
      )
      .await
      .map_err(|e| e.to_string())?;
      let title = clean_title(raw_title.as_deref().unwrap_or(""));
      if title.is_empty() {
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
    }
    if notified_start {
      emit_title_generation_ended(&app, &conversation_id);
    }
  });
}
