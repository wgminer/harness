//! Pure state machine for global Fn recording: single tap toggles recording on/off; Escape cancels.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionMode {
    None,
    Toggle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FnRecordingState {
    pub session: SessionMode,
    pub tap_down_ms: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FnEdge {
    Down,
    Up,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GlobalRecordingEffect {
    StartRecording,
    StopRecording,
    CancelRecording,
}

pub fn create_initial_fn_recording_state() -> FnRecordingState {
    FnRecordingState {
        session: SessionMode::None,
        tap_down_ms: None,
    }
}

pub fn reduce_fn_edge(
    state: FnRecordingState,
    phase: FnEdge,
    ms: i64,
) -> (FnRecordingState, Vec<GlobalRecordingEffect>) {
    match phase {
        FnEdge::Down => reduce_down(state, ms),
        FnEdge::Up => reduce_up(state, ms),
    }
}

fn reduce_down(
    state: FnRecordingState,
    ms: i64,
) -> (FnRecordingState, Vec<GlobalRecordingEffect>) {
    (
        FnRecordingState {
            tap_down_ms: Some(ms),
            ..state
        },
        Vec::new(),
    )
}

fn reduce_up(
    state: FnRecordingState,
    _ms: i64,
) -> (FnRecordingState, Vec<GlobalRecordingEffect>) {
    if state.tap_down_ms.is_none() {
        return (state, Vec::new());
    }

    match state.session {
        SessionMode::None => (
            FnRecordingState {
                session: SessionMode::Toggle,
                tap_down_ms: None,
            },
            vec![GlobalRecordingEffect::StartRecording],
        ),
        SessionMode::Toggle => (
            FnRecordingState {
                session: SessionMode::None,
                tap_down_ms: None,
            },
            vec![GlobalRecordingEffect::StopRecording],
        ),
    }
}

pub fn reduce_escape(state: FnRecordingState) -> (FnRecordingState, Vec<GlobalRecordingEffect>) {
    if state.session == SessionMode::None {
        return (state, Vec::new());
    }
    (
        create_initial_fn_recording_state(),
        vec![GlobalRecordingEffect::CancelRecording],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0: i64 = 1_000_000;

    #[test]
    fn single_tap_starts_recording() {
        let s0 = create_initial_fn_recording_state();
        let (s1, e1) = reduce_fn_edge(s0, FnEdge::Down, T0);
        assert!(e1.is_empty());
        assert_eq!(s1.session, SessionMode::None);

        let (s2, e2) = reduce_fn_edge(s1, FnEdge::Up, T0 + 50);
        assert_eq!(e2, vec![GlobalRecordingEffect::StartRecording]);
        assert_eq!(s2.session, SessionMode::Toggle);
    }

    #[test]
    fn next_tap_stops_recording() {
        let (s, _) = reduce_fn_edge(
            reduce_fn_edge(create_initial_fn_recording_state(), FnEdge::Down, T0).0,
            FnEdge::Up,
            T0 + 50,
        );
        let (s, _) = reduce_fn_edge(s, FnEdge::Down, T0 + 100);
        let (s, effects) = reduce_fn_edge(s, FnEdge::Up, T0 + 150);
        assert_eq!(effects, vec![GlobalRecordingEffect::StopRecording]);
        assert_eq!(s.session, SessionMode::None);
    }

    #[test]
    fn up_without_down_does_nothing() {
        let (s, effects) = reduce_fn_edge(create_initial_fn_recording_state(), FnEdge::Up, T0);
        assert!(effects.is_empty());
        assert_eq!(s.session, SessionMode::None);
    }

    #[test]
    fn escape_cancels_from_toggle() {
        let (s, _) = reduce_fn_edge(
            reduce_fn_edge(create_initial_fn_recording_state(), FnEdge::Down, T0).0,
            FnEdge::Up,
            T0 + 10,
        );
        let (s, effects) = reduce_escape(s);
        assert_eq!(effects, vec![GlobalRecordingEffect::CancelRecording]);
        assert_eq!(s.session, SessionMode::None);
    }
}
