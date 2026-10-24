//! Responses API stream details genai's normalized events leave out, read from the
//! raw SSE frames: reasoning-summary part breaks, summaries that arrive only on the
//! finished reasoning item, and refusal text.

use std::sync::{Arc, Mutex};

use genai::chat::{ChatOptions, FrameCtx, RawFrameRef};
use serde_json::Value;

#[derive(Debug, Default, PartialEq)]
pub(super) struct RawFrameState {
    /// A new summary part started; separate it from the previous one.
    pub part_break_pending: bool,
    /// The current reasoning item streamed summary deltas.
    item_streamed: bool,
    /// Summaries taken from finished reasoning items that had no deltas.
    pub fallback_reasoning: Vec<String>,
    /// Refusal deltas, shown as reply text.
    pub refusal_text: Vec<String>,
}

impl RawFrameState {
    pub(super) fn apply(&mut self, event: &Value) {
        match event.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "response.reasoning_summary_part.added" => self.part_break_pending = true,
            "response.reasoning_summary_text.delta" => self.item_streamed = true,
            "response.refusal.delta" => {
                let delta = event.get("delta").and_then(|v| v.as_str()).unwrap_or("");
                if !delta.is_empty() {
                    self.refusal_text.push(delta.to_string());
                }
            }
            "response.output_item.done" => {
                let Some(item) = event.get("item") else {
                    return;
                };
                if item.get("type").and_then(|v| v.as_str()) != Some("reasoning") {
                    return;
                }
                if std::mem::take(&mut self.item_streamed) {
                    return;
                }
                let summary = item
                    .get("summary")
                    .and_then(|v| v.as_array())
                    .map(|parts| {
                        parts
                            .iter()
                            .filter_map(|part| part.get("text").and_then(|v| v.as_str()))
                            .collect::<Vec<_>>()
                            .join("\n\n")
                    })
                    .unwrap_or_default();
                if !summary.is_empty() {
                    self.fallback_reasoning.push(summary);
                }
            }
            _ => {}
        }
    }
}

/// Shared state filled from raw frames while a stream runs.
pub(super) type RawFrames = Arc<Mutex<RawFrameState>>;

pub(super) fn with_raw_frames(options: ChatOptions, frames: &RawFrames) -> ChatOptions {
    let frames = frames.clone();
    options.with_raw_frame_fn(move |_ctx: &FrameCtx, frame: RawFrameRef<'_>| {
        if let Some(event) = frame.json() {
            frames.lock().unwrap().apply(&event);
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn flags_part_breaks_and_refusals() {
        let mut state = RawFrameState::default();
        state.apply(&json!({ "type": "response.reasoning_summary_part.added" }));
        state.apply(&json!({ "type": "response.refusal.delta", "delta": "No." }));
        assert!(state.part_break_pending);
        assert_eq!(state.refusal_text, vec!["No."]);
    }

    #[test]
    fn falls_back_to_finished_reasoning_item_without_deltas() {
        let mut state = RawFrameState::default();
        state.apply(&json!({ "type": "response.output_item.done", "item": {
            "type": "reasoning", "id": "rs_1", "summary": [
                { "type": "summary_text", "text": "One" },
                { "type": "summary_text", "text": "Two" }
            ]
        } }));
        state.apply(&json!({ "type": "response.output_item.done", "item": {
            "type": "reasoning", "id": "rs_2", "summary": []
        } }));
        assert_eq!(state.fallback_reasoning, vec!["One\n\nTwo"]);
    }

    #[test]
    fn skips_fallback_when_summary_streamed() {
        let mut state = RawFrameState::default();
        state.apply(&json!({ "type": "response.reasoning_summary_text.delta", "delta": "One" }));
        state.apply(&json!({ "type": "response.output_item.done", "item": {
            "type": "reasoning", "summary": [{ "type": "summary_text", "text": "One" }]
        } }));
        assert!(state.fallback_reasoning.is_empty());
    }
}
