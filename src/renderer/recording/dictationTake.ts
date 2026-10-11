import { useEffect, useSyncExternalStore } from "react";
import { MICROPHONE_PERMISSION_DENIED_MESSAGE } from "./recordingAudioUtils";
import { transcribeWav } from "./recordingPipeline";
import { playCancelChime, playDoneChime, playErrorChime } from "./recordingUtils";
import { createRecorder } from "./useRecorder";

/**
 * The one in-flight dictation take. It lives outside React so a take keeps running,
 * and stays controllable, while the user moves between views.
 */

const MAX_RECORDING_MS = 5 * 60 * 1000;

/** Where a take's transcript lands; pinned when the take starts. */
export type TakeLanding =
  | { surface: "note"; noteId: string }
  | { surface: "chat"; conversationId: string | null }
  | { surface: "tasks" };

export type DictationTake = {
  /** `mic`: in-app capture in the renderer. `fn`: native capture from the global Fn hotkey. */
  source: "mic" | "fn";
  phase: "recording" | "processing";
  startedAt: number;
  /** Null for unfocused Fn takes, which Rust delivers to a new dictation conversation. */
  landing: TakeLanding | null;
};

export type TakeTranscriptResult = {
  cleanupSkipped?: "no_api_key";
  recordingPath?: string;
};

/** A mounted surface that can take a transcript for its landing directly. */
export type TakeHandler = {
  deliver: (text: string, result?: TakeTranscriptResult) => void | boolean | Promise<void | boolean>;
  onError: (message: string) => void;
};

/** App-level navigation the store needs when the landing surface is not on screen. */
export type TakeHost = {
  isLandingCurrent: (landing: TakeLanding) => boolean;
  showLanding: (landing: TakeLanding) => void;
  /**
   * Hand the transcript to the landing surface once it mounts. False when the
   * surface has no pending-text path; the store then waits for its handler.
   */
  deliverPending: (landing: TakeLanding, text: string) => boolean;
  reportError: (message: string) => void;
};

export function landingKey(landing: TakeLanding): string {
  if (landing.surface === "note") return `note:${landing.noteId}`;
  if (landing.surface === "chat") return `chat:${landing.conversationId ?? ""}`;
  return landing.surface;
}

let take: DictationTake | null = null;
let level = 0;
let host: TakeHost | null = null;
let startAttempt = 0;
let starting = false;
let transcriptionId = 0;
let maxTimer: ReturnType<typeof setTimeout> | null = null;
/** A transcript waiting for its landing surface to mount. */
let pending: { key: string; text: string; result: TakeTranscriptResult } | null = null;
/** Mounted surfaces currently drawing the take in their own voice chrome. */
let inlineChromeCount = 0;
const listeners = new Set<() => void>();
const handlers = new Map<string, TakeHandler>();
const recorder = createRecorder({
  onLevel: (next) => {
    level = next;
  },
});

function notify(): void {
  for (const listener of listeners) listener();
}

function setTake(next: DictationTake | null): void {
  take = next;
  if (!next || next.phase !== "recording") level = 0;
  notify();
}

function clearMaxTimer(): void {
  if (maxTimer) clearTimeout(maxTimer);
  maxTimer = null;
}

export function subscribeTake(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTake(): DictationTake | null {
  return take;
}

/** Latest input peak, 0..1. Read per frame; it does not notify subscribers. */
export function getTakeLevel(): number {
  return level;
}

export function setTakeLevel(next: number): void {
  if (take?.phase === "recording") level = next;
}

export function wireTakeHost(next: TakeHost | null): void {
  host = next;
}

export function registerTakeHandler(key: string, handler: TakeHandler): () => void {
  handlers.set(key, handler);
  if (pending?.key === key) {
    const { text, result } = pending;
    pending = null;
    void handler.deliver(text, result);
  }
  return () => {
    if (handlers.get(key) === handler) handlers.delete(key);
  };
}

function reportError(landing: TakeLanding | null, message: string): void {
  const handler = landing ? handlers.get(landingKey(landing)) : undefined;
  if (handler && landing && host?.isLandingCurrent(landing) !== false) {
    handler.onError(message);
    return;
  }
  host?.reportError(message);
}

async function deliver(landing: TakeLanding, text: string, result: TakeTranscriptResult): Promise<void> {
  // Read the handler first: showing the landing can remount the surface.
  const handler = handlers.get(landingKey(landing));
  host?.showLanding(landing);
  if (handler) {
    await handler.deliver(text, result);
    return;
  }
  if (!host?.deliverPending(landing, text)) {
    pending = { key: landingKey(landing), text, result };
  }
}

export async function startMicTake(landing: TakeLanding): Promise<void> {
  if (take || starting) return;
  const attempt = ++startAttempt;
  starting = true;
  try {
    await recorder.start();
  } catch (err) {
    starting = false;
    if (attempt !== startAttempt) return;
    void playErrorChime();
    reportError(landing, err instanceof Error ? err.message : MICROPHONE_PERMISSION_DENIED_MESSAGE);
    return;
  }
  starting = false;
  // Cancelled, or an Fn take began, while the mic was opening.
  if (attempt !== startAttempt || take) {
    await recorder.cancel();
    return;
  }
  setTake({ source: "mic", phase: "recording", startedAt: Date.now(), landing });
  maxTimer = setTimeout(() => void stopTake(), MAX_RECORDING_MS);
}

/** Finish the take: transcribe it and land the text. */
export async function stopTake(): Promise<void> {
  const current = take;
  if (!current || current.phase !== "recording") return;
  clearMaxTimer();
  setTake({ ...current, phase: "processing" });
  if (current.source === "fn") {
    await window.harness.recording.stopGlobalRecording().catch(() => {});
    return;
  }
  const id = ++transcriptionId;
  const landing = current.landing;
  try {
    const wav = await recorder.stop();
    const result = await transcribeWav(wav);
    if (id !== transcriptionId) return;
    if ("error" in result) {
      void playErrorChime();
      reportError(landing, result.error);
    } else if (landing) {
      void playDoneChime();
      await deliver(landing, result.text, {
        cleanupSkipped: result.cleanupSkipped === "no_api_key" ? "no_api_key" : undefined,
        recordingPath: result.path,
      });
    }
  } catch (err) {
    if (id !== transcriptionId) return;
    void playErrorChime();
    reportError(landing, err instanceof Error ? err.message : "Recording failed.");
  } finally {
    if (id === transcriptionId && take?.source === "mic") setTake(null);
  }
}

/** Drop the take, in any phase, and release the mic. */
export async function cancelTake(): Promise<void> {
  const current = take;
  const wasActive = current != null || starting;
  startAttempt += 1;
  clearMaxTimer();
  if (current?.source === "fn") {
    setTake(null);
    await window.harness.recording.cancelGlobalSession().catch(() => {});
    return;
  }
  transcriptionId += 1;
  setTake(null);
  await recorder.cancel();
  if (wasActive) await playCancelChime();
}

/** Global Fn capture started natively; it replaces any in-app take. */
export function beginFnTake(landing: TakeLanding | null): void {
  if (take?.source === "mic" || starting) {
    startAttempt += 1;
    transcriptionId += 1;
    clearMaxTimer();
    void recorder.cancel();
  }
  setTake({ source: "fn", phase: "recording", startedAt: Date.now(), landing });
}

/** Fn capture stopped (or a saved take is being retried) and is transcribing. */
export function markFnTakeProcessing(): void {
  if (take?.source === "mic") return;
  setTake({
    source: "fn",
    phase: "processing",
    startedAt: take?.startedAt ?? Date.now(),
    landing: take?.landing ?? null,
  });
}

export function endFnTake(): void {
  if (take?.source === "fn") setTake(null);
}

function getInlineChrome(): boolean {
  return inlineChromeCount > 0;
}

export function useDictationTake(): DictationTake | null {
  return useSyncExternalStore(subscribeTake, getTake);
}

/** True while some mounted surface is drawing the take in its own voice chrome. */
export function useTakeHasInlineChrome(): boolean {
  return useSyncExternalStore(subscribeTake, getInlineChrome);
}

/** Call from a surface's voice chrome while it is showing the take. */
export function useInlineTakeChrome(showing: boolean): void {
  useEffect(() => {
    if (!showing) return;
    inlineChromeCount += 1;
    notify();
    return () => {
      inlineChromeCount -= 1;
      notify();
    };
  }, [showing]);
}

/** Reset module state (tests only). */
export function resetDictationTakeForTests(): void {
  take = null;
  level = 0;
  host = null;
  startAttempt = 0;
  starting = false;
  transcriptionId = 0;
  pending = null;
  inlineChromeCount = 0;
  clearMaxTimer();
  listeners.clear();
  handlers.clear();
}
