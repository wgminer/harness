//! Coarse UI flushes for streamed assistant/note text.
//! Thresholds from `resources/contracts/chatStreamBatch.json`.

use std::time::{Duration, Instant};

use serde::Deserialize;

const CHAT_STREAM_BATCH_JSON: &str =
    include_str!("../../../resources/contracts/chatStreamBatch.json");

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamBatchPolicy {
    pub min_chars: usize,
    pub max_hold_ms: u64,
    pub newline_min_chars: usize,
}

pub fn chat_stream_batch_policy() -> ChatStreamBatchPolicy {
    serde_json::from_str(CHAT_STREAM_BATCH_JSON)
        .expect("resources/contracts/chatStreamBatch.json must parse")
}

/// Accumulates token deltas and yields larger UI chunks.
pub struct StreamTextBatcher {
    buffer: String,
    buffer_started_at: Option<Instant>,
    policy: ChatStreamBatchPolicy,
}

impl StreamTextBatcher {
    pub fn new(policy: ChatStreamBatchPolicy) -> Self {
        Self {
            buffer: String::new(),
            buffer_started_at: None,
            policy,
        }
    }

    pub fn from_contract() -> Self {
        Self::new(chat_stream_batch_policy())
    }

    pub fn push(&mut self, chunk: &str) -> Option<String> {
        if chunk.is_empty() {
            return None;
        }
        if self.buffer.is_empty() {
            self.buffer_started_at = Some(Instant::now());
        }
        self.buffer.push_str(chunk);
        self.maybe_flush(false)
    }

    pub fn flush(&mut self) -> Option<String> {
        self.maybe_flush(true)
    }

    #[cfg(test)]
    pub fn pending(&self) -> &str {
        &self.buffer
    }

    fn maybe_flush(&mut self, force: bool) -> Option<String> {
        if self.buffer.is_empty() {
            return None;
        }
        if force {
            return Some(self.take_all());
        }

        let char_len = self.buffer.chars().count();
        let held_long = self
            .buffer_started_at
            .map(|started| started.elapsed() >= Duration::from_millis(self.policy.max_hold_ms))
            .unwrap_or(false);

        if let Some(nl) = self.buffer.rfind('\n') {
            let prefix_chars = self.buffer[..=nl].chars().count();
            if prefix_chars >= self.policy.newline_min_chars {
                let out = self.buffer[..=nl].to_string();
                self.buffer = self.buffer[nl + 1..].to_string();
                self.buffer_started_at = if self.buffer.is_empty() {
                    None
                } else {
                    Some(Instant::now())
                };
                return Some(out);
            }
        }

        if char_len >= self.policy.min_chars || held_long {
            return Some(self.take_all());
        }
        None
    }

    fn take_all(&mut self) -> String {
        self.buffer_started_at = None;
        std::mem::take(&mut self.buffer)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> ChatStreamBatchPolicy {
        ChatStreamBatchPolicy {
            min_chars: 150,
            max_hold_ms: 350,
            newline_min_chars: 40,
        }
    }

    #[test]
    fn contract_parses_with_expected_shape() {
        let p = chat_stream_batch_policy();
        assert!(p.min_chars > 0);
        assert!(p.max_hold_ms > 0);
        assert!(p.newline_min_chars > 0);
        assert!(p.newline_min_chars < p.min_chars);
    }

    #[test]
    fn holds_small_deltas_until_min_chars() {
        let mut b = StreamTextBatcher::new(policy());
        assert!(b.push("hello ").is_none());
        assert!(b.push("world").is_none());
        assert_eq!(b.pending(), "hello world");
    }

    #[test]
    fn flushes_when_min_chars_reached() {
        let mut b = StreamTextBatcher::new(policy());
        let chunk = "a".repeat(150);
        assert_eq!(b.push(&chunk).as_deref(), Some(chunk.as_str()));
        assert_eq!(b.pending(), "");
    }

    #[test]
    fn flushes_through_last_newline_once_newline_min_met() {
        let mut b = StreamTextBatcher::new(policy());
        let para = format!("{}\n", "x".repeat(38));
        assert!(b.push(&para).is_none());
        let out = b.push("y\ntrailing").unwrap();
        assert_eq!(out, format!("{para}y\n"));
        assert_eq!(b.pending(), "trailing");
    }

    #[test]
    fn force_flush_returns_remainder() {
        let mut b = StreamTextBatcher::new(policy());
        b.push("partial");
        assert_eq!(b.flush().as_deref(), Some("partial"));
        assert!(b.flush().is_none());
    }
}
