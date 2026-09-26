import { MICROPHONE_PERMISSION_DENIED_MESSAGE } from "./recordingAudioUtils";

let ready = false;
let readyPromise: Promise<void> | null = null;
let bootstrapStream: MediaStream | null = null;

/** Reset bootstrap state (tests only). */
export function resetRecordingBootstrapForTests(): void {
  ready = false;
  readyPromise = null;
  bootstrapStream?.getTracks().forEach((t) => t.stop());
  bootstrapStream = null;
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

  const tracksLive = bootstrapStream?.getAudioTracks().some((t) => t.readyState === "live") ?? false;
  if (!tracksLive) {
    bootstrapStream?.getTracks().forEach((t) => t.stop());
    bootstrapStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  ready = true;
}

/** Ensure macOS mic TCC + a live getUserMedia stream for in-app recording. */
export async function ensureRecordingReady(): Promise<void> {
  if (ready) return;
  if (readyPromise) return readyPromise;
  readyPromise = doEnsureReady().finally(() => {
    readyPromise = null;
  });
  return readyPromise;
}

/** Reuse a live bootstrap stream when available; otherwise acquire a new one. */
export async function acquireRecordingStream(): Promise<{
  stream: MediaStream;
  releaseOnStop: boolean;
}> {
  await ensureRecordingReady();
  const tracksLive = bootstrapStream?.getAudioTracks().some((t) => t.readyState === "live") ?? false;
  if (tracksLive && bootstrapStream) {
    return { stream: bootstrapStream, releaseOnStop: false };
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  return { stream, releaseOnStop: true };
}

/** Create a fresh AudioContext for an active recording session. */
export async function createRecordingAudioContext(): Promise<AudioContext> {
  await ensureRecordingReady();
  const ctx = new AudioContext();
  await resumeAudioContext(ctx);
  return ctx;
}
