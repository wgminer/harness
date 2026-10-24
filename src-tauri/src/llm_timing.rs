//! Wall-clock timings for OpenAI requests, kept so slow replies can be
//! checked from Settings later. Local only: `.harness/llm-timings.json` sits
//! outside every sync scope.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

const TIMINGS_FILE: &str = "llm-timings.json";
const MAX_TIMINGS: usize = 200;

static TIMINGS: Mutex<Option<VecDeque<LlmTiming>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmTiming {
    /// Request start, unix ms.
    pub started_at: u64,
    /// `chat`, `title`, `json`, `cleanup`, `image`, or `imageEdit`.
    pub kind: String,
    pub model: String,
    /// 1-based model round within one chat turn (tool calls add rounds).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub round: Option<u32>,
    /// Time until the first streamed text or reasoning delta (chat only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_token_ms: Option<u64>,
    pub total_ms: u64,
    /// `ok`, `error`, or `cancelled`.
    pub outcome: String,
}

fn timings_path() -> PathBuf {
    crate::paths::get_local_data_dir().join(TIMINGS_FILE)
}

fn load_from_disk() -> VecDeque<LlmTiming> {
    if cfg!(test) {
        return VecDeque::new();
    }
    std::fs::read_to_string(timings_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<VecDeque<LlmTiming>>(&raw).ok())
        .unwrap_or_default()
}

fn push(entry: LlmTiming) {
    let Ok(mut guard) = TIMINGS.lock() else {
        return;
    };
    let list = guard.get_or_insert_with(load_from_disk);
    list.push_front(entry);
    list.truncate(MAX_TIMINGS);
    if cfg!(test) {
        return;
    }
    if let Ok(json) = serde_json::to_string(list) {
        let _ = std::fs::write(timings_path(), json);
    }
}

/// Newest first.
pub fn list(limit: usize) -> Vec<LlmTiming> {
    let Ok(mut guard) = TIMINGS.lock() else {
        return Vec::new();
    };
    let list = guard.get_or_insert_with(load_from_disk);
    list.iter().take(limit).cloned().collect()
}

pub fn clear() {
    if let Ok(mut guard) = TIMINGS.lock() {
        *guard = Some(VecDeque::new());
    }
    if !cfg!(test) {
        let _ = std::fs::remove_file(timings_path());
    }
}

/// Records one request when dropped. Unless `ok()` was called, the outcome is
/// `cancelled` when the token fired and `error` otherwise, so early `?`
/// returns are still logged.
pub struct RequestTimer {
    started: Instant,
    started_at: u64,
    kind: &'static str,
    model: String,
    round: Option<u32>,
    first_token_ms: Option<u64>,
    cancel: Option<CancellationToken>,
    ok: bool,
}

impl RequestTimer {
    pub fn start(kind: &'static str, model: impl Into<String>) -> Self {
        let started_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Self {
            started: Instant::now(),
            started_at,
            kind,
            model: model.into(),
            round: None,
            first_token_ms: None,
            cancel: None,
            ok: false,
        }
    }

    pub fn round(mut self, round: u32) -> Self {
        self.round = Some(round);
        self
    }

    pub fn cancel_token(mut self, cancel: Option<&CancellationToken>) -> Self {
        self.cancel = cancel.cloned();
        self
    }

    pub fn mark_first_token(&mut self) {
        if self.first_token_ms.is_none() {
            self.first_token_ms = Some(self.started.elapsed().as_millis() as u64);
        }
    }

    pub fn ok(mut self) {
        self.ok = true;
    }
}

impl Drop for RequestTimer {
    fn drop(&mut self) {
        let outcome = if self.ok {
            "ok"
        } else if self.cancel.as_ref().is_some_and(|t| t.is_cancelled()) {
            "cancelled"
        } else {
            "error"
        };
        push(LlmTiming {
            started_at: self.started_at,
            kind: self.kind.to_string(),
            model: std::mem::take(&mut self.model),
            round: self.round,
            first_token_ms: self.first_token_ms,
            total_ms: self.started.elapsed().as_millis() as u64,
            outcome: outcome.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timer_records_outcomes_newest_first() {
        clear();
        RequestTimer::start("title", "m").ok();
        drop(RequestTimer::start("json", "m"));
        let token = CancellationToken::new();
        token.cancel();
        let mut chat = RequestTimer::start("chat", "m").round(2).cancel_token(Some(&token));
        chat.mark_first_token();
        drop(chat);

        let entries = list(10);
        let summary: Vec<(&str, &str)> = entries
            .iter()
            .map(|e| (e.kind.as_str(), e.outcome.as_str()))
            .collect();
        assert_eq!(
            summary,
            vec![("chat", "cancelled"), ("json", "error"), ("title", "ok")]
        );
        assert_eq!(entries[0].round, Some(2));
        assert!(entries[0].first_token_ms.is_some());
        assert!(entries[1].first_token_ms.is_none());
    }
}
