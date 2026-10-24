//! Step timings for recent dictations (transcribe, cleanup, paste, then the
//! title and reply-action calls that run afterwards), so slow dictations can be
//! checked from Settings. Local only: `.harness/dictation-timings.json` sits
//! outside every sync scope.

use std::collections::VecDeque;
use std::future::Future;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const TIMINGS_FILE: &str = "dictation-timings.json";
const MAX_DICTATIONS: usize = 5;
/// Title and reply-action calls only attach to a dictation this recent.
const FOLLOW_UP_WINDOW_MS: u64 = 2 * 60 * 1000;

static DICTATIONS: Mutex<Option<VecDeque<DictationTiming>>> = Mutex::new(None);

tokio::task_local! {
    static CURRENT_DICTATION: String;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationTiming {
    pub id: String,
    /// When processing began (recording stopped), unix ms.
    pub started_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_ms: Option<u64>,
    /// Time from stop until the text was delivered (pasted or handed to the UI).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ready_ms: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,
    pub steps: Vec<DictationStep>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DictationStep {
    pub name: String,
    /// Engine or model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    /// Offset from the dictation's `started_at`.
    pub start_ms: u64,
    pub duration_ms: u64,
    /// `ok`, `error`, or `cancelled`.
    pub outcome: String,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn timings_path() -> PathBuf {
    crate::paths::get_local_data_dir().join(TIMINGS_FILE)
}

fn load_from_disk() -> VecDeque<DictationTiming> {
    if cfg!(test) {
        return VecDeque::new();
    }
    std::fs::read_to_string(timings_path())
        .ok()
        .and_then(|raw| serde_json::from_str::<VecDeque<DictationTiming>>(&raw).ok())
        .unwrap_or_default()
}

/// Apply `f` to the stored list, then persist it.
fn update<R>(f: impl FnOnce(&mut VecDeque<DictationTiming>) -> R) -> Option<R> {
    let mut guard = DICTATIONS.lock().ok()?;
    let list = guard.get_or_insert_with(load_from_disk);
    let result = f(list);
    if !cfg!(test) {
        if let Ok(json) = serde_json::to_string(list) {
            let _ = std::fs::write(timings_path(), json);
        }
    }
    Some(result)
}

/// Newest first.
pub fn list() -> Vec<DictationTiming> {
    let Ok(mut guard) = DICTATIONS.lock() else {
        return Vec::new();
    };
    guard.get_or_insert_with(load_from_disk).iter().cloned().collect()
}

/// Audio length of a 16-bit PCM WAV with a standard 44-byte header.
pub fn wav_duration_ms(wav: &[u8]) -> Option<u64> {
    let byte_rate = u32::from_le_bytes(wav.get(28..32)?.try_into().ok()?) as u64;
    if byte_rate == 0 || wav.len() < 44 {
        return None;
    }
    Some((wav.len() as u64 - 44) * 1000 / byte_rate)
}

/// Run one dictation's processing with step timers attached to a new entry.
/// `ready_ms` is stamped when `fut` finishes.
pub async fn track<F: Future>(audio_ms: Option<u64>, fut: F) -> F::Output {
    let id = Uuid::new_v4().to_string();
    let started_at = now_ms();
    update(|list| {
        list.push_front(DictationTiming {
            id: id.clone(),
            started_at,
            audio_ms,
            ready_ms: None,
            conversation_id: None,
            steps: Vec::new(),
        });
        list.truncate(MAX_DICTATIONS);
    });
    let output = CURRENT_DICTATION.scope(id.clone(), fut).await;
    let ready_ms = now_ms().saturating_sub(started_at);
    update(|list| {
        if let Some(entry) = list.iter_mut().find(|d| d.id == id) {
            entry.ready_ms = Some(ready_ms);
        }
    });
    output
}

/// Tie a saved dictation conversation to its timing entry so the title and
/// reply-action calls land on it. Inside `track` that is the current entry;
/// otherwise (the dictation screen saves after transcription returns) it is the
/// newest recent entry not yet linked.
pub fn link_conversation(conversation_id: &str) {
    let current = CURRENT_DICTATION.try_with(|id| id.clone()).ok();
    let cutoff = now_ms().saturating_sub(FOLLOW_UP_WINDOW_MS);
    update(|list| {
        let entry = match current {
            Some(id) => list.iter_mut().find(|d| d.id == id),
            None => list
                .iter_mut()
                .find(|d| d.conversation_id.is_none() && d.started_at >= cutoff),
        };
        if let Some(entry) = entry {
            entry.conversation_id = Some(conversation_id.to_string());
        }
    });
}

/// Times one step. Records on drop as `error` unless `ok()` or `cancelled()`
/// was called, so early returns are still logged. A no-op when no dictation
/// matches.
pub struct StepTimer {
    dictation_id: Option<String>,
    name: &'static str,
    detail: Option<String>,
    started_at: u64,
    outcome: &'static str,
}

impl StepTimer {
    /// Attach to the dictation running in this task, if any.
    pub fn start(name: &'static str, detail: impl Into<String>) -> Self {
        let dictation_id = CURRENT_DICTATION.try_with(|id| id.clone()).ok();
        Self::new(dictation_id, name, detail.into())
    }

    /// Attach to the recent dictation that saved `conversation_id`, if any.
    pub fn for_conversation(
        conversation_id: &str,
        name: &'static str,
        detail: impl Into<String>,
    ) -> Self {
        let cutoff = now_ms().saturating_sub(FOLLOW_UP_WINDOW_MS);
        let dictation_id = DICTATIONS.lock().ok().and_then(|mut guard| {
            guard
                .get_or_insert_with(load_from_disk)
                .iter()
                .find(|d| {
                    d.started_at >= cutoff && d.conversation_id.as_deref() == Some(conversation_id)
                })
                .map(|d| d.id.clone())
        });
        Self::new(dictation_id, name, detail.into())
    }

    fn new(dictation_id: Option<String>, name: &'static str, detail: String) -> Self {
        Self {
            dictation_id,
            name,
            detail: Some(detail).filter(|d| !d.is_empty()),
            started_at: now_ms(),
            outcome: "error",
        }
    }

    pub fn ok(mut self) {
        self.outcome = "ok";
    }

    pub fn cancelled(mut self) {
        self.outcome = "cancelled";
    }
}

impl Drop for StepTimer {
    fn drop(&mut self) {
        let Some(id) = self.dictation_id.take() else {
            return;
        };
        let ended_at = now_ms();
        update(|list| {
            if let Some(entry) = list.iter_mut().find(|d| d.id == id) {
                entry.steps.push(DictationStep {
                    name: self.name.to_string(),
                    detail: self.detail.take(),
                    start_ms: self.started_at.saturating_sub(entry.started_at),
                    duration_ms: ended_at.saturating_sub(self.started_at),
                    outcome: self.outcome.to_string(),
                });
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_duration_reads_byte_rate() {
        let mut wav = vec![0u8; 44 + 32_000];
        wav[28..32].copy_from_slice(&32_000u32.to_le_bytes());
        assert_eq!(wav_duration_ms(&wav), Some(1000));
        assert_eq!(wav_duration_ms(&[0u8; 10]), None);
    }

    #[tokio::test]
    async fn steps_attach_inside_track_and_by_conversation() {
        StepTimer::start("Orphan", "").ok();
        track(Some(1500), async {
            StepTimer::start("Transcribe", "Parakeet").ok();
            drop(StepTimer::start("Cleanup", "m"));
            link_conversation("conv-1");
        })
        .await;
        StepTimer::for_conversation("conv-1", "Title", "m").ok();
        StepTimer::for_conversation("conv-2", "Title", "m").ok();

        let latest = list().into_iter().next().unwrap();
        assert_eq!(latest.audio_ms, Some(1500));
        assert!(latest.ready_ms.is_some());
        let steps: Vec<(&str, &str)> = latest
            .steps
            .iter()
            .map(|s| (s.name.as_str(), s.outcome.as_str()))
            .collect();
        assert_eq!(
            steps,
            vec![("Transcribe", "ok"), ("Cleanup", "error"), ("Title", "ok")]
        );
    }
}
