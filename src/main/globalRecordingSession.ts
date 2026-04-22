/**
 * Pure state machine for global Fn recording:
 * single tap toggles recording on/off; Escape cancels.
 */

export type SessionMode = "none" | "toggle";

export interface FnRecordingState {
  session: SessionMode;
  /** Tracks whether a tap is currently in progress. */
  tapDownMs: number | null;
}

export type FnEdge = "down" | "up";

export type GlobalRecordingEffect =
  | { kind: "startRecording" }
  | { kind: "stopRecording" }
  | { kind: "cancelRecording" };

export function createInitialFnRecordingState(): FnRecordingState {
  return {
    session: "none",
    tapDownMs: null,
  };
}

/**
 * Reduce one Fn edge (down/up) with timestamp `ms`.
 */
export function reduceFnEdge(
  state: FnRecordingState,
  phase: FnEdge,
  ms: number
): { next: FnRecordingState; effects: GlobalRecordingEffect[] } {
  const effects: GlobalRecordingEffect[] = [];

  if (phase === "down") {
    return reduceDown(state, ms, effects);
  }
  return reduceUp(state, ms, effects);
}

function reduceDown(
  state: FnRecordingState,
  ms: number,
  effects: GlobalRecordingEffect[]
): { next: FnRecordingState; effects: GlobalRecordingEffect[] } {
  // Start tracking a tap; toggling happens on key-up.
  return {
    next: {
      ...state,
      tapDownMs: ms,
    },
    effects,
  };
}

function reduceUp(
  state: FnRecordingState,
  _ms: number,
  effects: GlobalRecordingEffect[]
): { next: FnRecordingState; effects: GlobalRecordingEffect[] } {
  // Only react to key-up after a key-down.
  if (state.tapDownMs !== null) {
    if (state.session === "none") {
      effects.push({ kind: "startRecording" });
      return { next: { session: "toggle", tapDownMs: null }, effects };
    }
    if (state.session === "toggle") {
      effects.push({ kind: "stopRecording" });
      return { next: { session: "none", tapDownMs: null }, effects };
    }
  }

  return { next: state, effects };
}

/** Escape during PTT or latch: cancel and reset */
export function reduceEscape(state: FnRecordingState): {
  next: FnRecordingState;
  effects: GlobalRecordingEffect[];
} {
  if (state.session === "none") {
    return { next: state, effects: [] };
  }
  return {
    next: createInitialFnRecordingState(),
    effects: [{ kind: "cancelRecording" }],
  };
}
