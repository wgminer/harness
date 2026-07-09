let ready = false;
let primePromise: Promise<void> | null = null;
let bootstrapStream: MediaStream | null = null;
let bootstrapCtx: AudioContext | null = null;

export function isRecordingReady(): boolean {
  return ready;
}

/** Reset bootstrap state (tests only). */
export function resetRecordingBootstrapForTests(): void {
  ready = false;
  primePromise = null;
  bootstrapStream?.getTracks().forEach((t) => t.stop());
  bootstrapStream = null;
  void bootstrapCtx?.close().catch(() => {});
  bootstrapCtx = null;
}

async function resumeAudioContext(ctx: AudioContext): Promise<void> {
  if (ctx.state === "suspended") {
    await ctx.resume();
  }
  if (ctx.state !== "running") {
    throw new Error("Audio system is not ready. Click in Harness once, then try again.");
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
      throw new Error("Microphone access denied.");
    }
  }

  const tracksLive = bootstrapStream?.getAudioTracks().some((t) => t.readyState === "live") ?? false;
  if (!tracksLive) {
    bootstrapStream?.getTracks().forEach((t) => t.stop());
    bootstrapStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  }

  if (!bootstrapCtx || bootstrapCtx.state === "closed") {
    bootstrapCtx = new AudioContext();
  }
  await resumeAudioContext(bootstrapCtx);
  ready = true;
}

/** Idempotent mic + AudioContext priming for hotkey and in-app recording. */
export async function ensureRecordingReady(): Promise<void> {
  if (ready) return;
  if (primePromise) return primePromise;
  primePromise = doEnsureReady().finally(() => {
    primePromise = null;
  });
  return primePromise;
}

/**
 * Prime mic access on the first user gesture so Fn hotkey works without an in-app recording first.
 */
export function primeOnUserGesture(): void {
  const handler = () => {
    document.removeEventListener("pointerdown", handler, true);
    void ensureRecordingReady().catch(() => {
      /* permission may still be pending; hotkey path surfaces errors */
    });
  };
  document.addEventListener("pointerdown", handler, true);
}

/** Reuse the primed stream when available; otherwise acquire a new one. */
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
