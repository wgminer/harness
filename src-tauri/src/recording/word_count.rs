//! Running total of dictated words, per profile (`<profile>/.harness/`).
//!
//! Transcripts are not logged, so the first read seeds the total from this
//! profile's conversations; every successful transcription adds to it after.

use std::collections::HashMap;
use std::path::Path;

use serde_json::Value;

use crate::env_util::sanitize_conversation_id;
use crate::memory::{ConversationMeta, ConversationSessionKind, MessageRecord};
use crate::paths::{get_app_state_dir, get_local_data_dir, messages_file_in};

const WORD_COUNT_FILE_NAME: &str = "dictation_word_count.json";

static WORD_COUNT_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn count_words(text: &str) -> u64 {
    text.split_whitespace().count() as u64
}

/// Words already dictated into this profile's conversations: the first user
/// message of each dictation session, plus untagged single-message takes with
/// no reply (dictations from before sessions were tagged).
fn seed_from_conversations(app_state_dir: &Path) -> u64 {
    let Ok(data) = std::fs::read_to_string(app_state_dir.join("conversations.json")) else {
        return 0;
    };
    let Ok(convs) = serde_json::from_str::<HashMap<String, Value>>(&data) else {
        return 0;
    };
    let mut total = 0_u64;
    for (id, value) in convs {
        let Ok(meta) = serde_json::from_value::<ConversationMeta>(value) else {
            continue;
        };
        if meta.session_kind == Some(ConversationSessionKind::Chat) {
            continue;
        }
        let path = messages_file_in(app_state_dir, &sanitize_conversation_id(&id));
        let Some(messages) = std::fs::read_to_string(&path)
            .ok()
            .and_then(|d| serde_json::from_str::<Vec<MessageRecord>>(&d).ok())
        else {
            continue;
        };
        let mut user = messages.iter().filter(|m| m.role == "user");
        let Some(first) = user.next() else {
            continue;
        };
        let is_dictation = meta.session_kind == Some(ConversationSessionKind::Dictation);
        let lone_take = user.next().is_none() && !messages.iter().any(|m| m.role == "assistant");
        if is_dictation || lone_take {
            total = total.saturating_add(count_words(&first.content));
        }
    }
    total
}

fn write_total(state_dir: &Path, total: u64) -> Result<(), String> {
    std::fs::create_dir_all(state_dir).map_err(|e| e.to_string())?;
    let data = serde_json::json!({ "words": total }).to_string();
    std::fs::write(state_dir.join(WORD_COUNT_FILE_NAME), data).map_err(|e| e.to_string())
}

/// Caller holds `WORD_COUNT_LOCK`. Seeds and saves the total on first read.
fn load_or_seed(state_dir: &Path, app_state_dir: &Path) -> u64 {
    let saved = std::fs::read_to_string(state_dir.join(WORD_COUNT_FILE_NAME))
        .ok()
        .and_then(|data| serde_json::from_str::<Value>(&data).ok())
        .and_then(|v| v.get("words").and_then(Value::as_u64));
    if let Some(words) = saved {
        return words;
    }
    let seeded = seed_from_conversations(app_state_dir);
    let _ = write_total(state_dir, seeded);
    seeded
}

pub fn words_dictated_in(state_dir: &Path, app_state_dir: &Path) -> u64 {
    let _guard = WORD_COUNT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    load_or_seed(state_dir, app_state_dir)
}

pub fn add_words_dictated_in(
    state_dir: &Path,
    app_state_dir: &Path,
    transcript: &str,
) -> Result<(), String> {
    let words = count_words(transcript);
    if words == 0 {
        return Ok(());
    }
    let _guard = WORD_COUNT_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let total = load_or_seed(state_dir, app_state_dir).saturating_add(words);
    write_total(state_dir, total)
}

pub async fn words_dictated() -> u64 {
    tokio::task::spawn_blocking(|| words_dictated_in(&get_local_data_dir(), &get_app_state_dir()))
        .await
        .unwrap_or(0)
}

/// Fire-and-forget; the first call may seed from every conversation file.
pub fn add_words_dictated(transcript: &str) {
    let transcript = transcript.to_string();
    tokio::task::spawn_blocking(move || {
        let _ = add_words_dictated_in(&get_local_data_dir(), &get_app_state_dir(), &transcript);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: &Path, value: Value) {
        std::fs::write(path, value.to_string()).expect("write");
    }

    #[test]
    fn seeds_from_conversations_then_adds() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let state = tmp.path().join("state");
        let app_state = tmp.path().join("app-state");
        std::fs::create_dir_all(&app_state).expect("mkdir");
        write(
            &app_state.join("conversations.json"),
            serde_json::json!({
                "dict": { "createdAt": 1, "sessionKind": "dictation" },
                "old_take": { "createdAt": 2 },
                "chat": { "createdAt": 3, "sessionKind": "chat" },
                "old_chat": { "createdAt": 4 },
            }),
        );
        let msgs = |id: &str, v: Value| write(&messages_file_in(&app_state, id), v);
        msgs(
            "dict",
            serde_json::json!([
                { "role": "user", "content": "one two three" },
                { "role": "assistant", "content": "reply words here" },
                { "role": "user", "content": "typed follow up" },
            ]),
        );
        msgs("old_take", serde_json::json!([{ "role": "user", "content": "four five" }]));
        msgs("chat", serde_json::json!([{ "role": "user", "content": "typed chat" }]));
        msgs(
            "old_chat",
            serde_json::json!([
                { "role": "user", "content": "typed" },
                { "role": "assistant", "content": "reply" },
            ]),
        );

        assert_eq!(words_dictated_in(&state, &app_state), 5);
        add_words_dictated_in(&state, &app_state, "  six seven ").expect("add");
        add_words_dictated_in(&state, &app_state, "   ").expect("add empty");
        // Seeded once: later conversations are counted live, not re-read.
        msgs("old_take", serde_json::json!([]));
        assert_eq!(words_dictated_in(&state, &app_state), 7);
    }
}
