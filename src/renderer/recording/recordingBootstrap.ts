import { MICROPHONE_PERMISSION_DENIED_MESSAGE } from "./recordingAudioUtils";

let ready = false;
let readyPromise: Promise<void> | null = null;

/** Reset bootstrap state (tests only). */
export function resetRecordingBootstrapForTests(): void {
  ready = false;
  readyPromise = null;
}

async function resumeAudioContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  if (ctx.state !== "running") {
    throw new Error("Audio system is not ready.");
  }
}

async function doEnsureReady(): Promise<void> {
  if (ready) return;

  if (typeof window === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone is not available.");
  }

  if (window.harness?.recording?.requestMicrophoneAccess) {
    const ok = await window.harness.recording.requestMicrophoneAccess();
    if (!ok) {
      throw new Error(MICROPHONE_PERMISSION_DENIED_MESSAGE);
    }
  }

  ready = true;
}

/** Ensure macOS mic TCC for in-app recording. */
export async function ensureRecordingReady(): Promise<void> {
  if (ready) return;
  if (readyPromise) return readyPromise;
  readyPromise = doEnsureReady().finally(() => {
    readyPromise = null;
  });
  return readyPromise;
}

/**
 * Voice processing (echo cancellation etc.) makes macOS duck other apps' audio while the
 * mic is open; dictation does not need it, so ask for a plain capture.
 */
const DICTATION_AUDIO: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

/** Acquire a fresh mic stream for one take; the caller stops its tracks when the take ends. */
export async function acquireRecordingStream(): Promise<MediaStream> {
  await ensureRecordingReady();
  return navigator.mediaDevices.getUserMedia({ audio: DICTATION_AUDIO });
}

/** Create a fresh AudioContext for an active recording session. */
export async function createRecordingAudioContext(): Promise<AudioContext> {
  await ensureRecordingReady();
  const ctx = new AudioContext();
  await resumeAudioContext(ctx);
  return ctx;
}
