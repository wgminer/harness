import { beforeEach, describe, expect, it, vi } from "vitest";

const recorder = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  stop: vi.fn(async () => new ArrayBuffer(8)),
  cancel: vi.fn(async () => {}),
}));
const transcribeWav = vi.hoisted(() => vi.fn());

vi.mock("./useRecorder", () => ({ createRecorder: () => recorder }));
vi.mock("./recordingPipeline", () => ({ transcribeWav }));
vi.mock("./recordingUtils", () => ({
  playCancelChime: vi.fn(async () => {}),
  playDoneChime: vi.fn(async () => {}),
  playErrorChime: vi.fn(async () => {}),
}));

import {
  beginFnTake,
  cancelTake,
  endFnTake,
  getTake,
  markFnTakeProcessing,
  registerTakeHandler,
  resetDictationTakeForTests,
  startMicTake,
  stopTake,
  wireTakeHost,
  type TakeHost,
  type TakeLanding,
} from "./dictationTake";

const CHAT_A: TakeLanding = { surface: "chat", conversationId: "a" };

function makeHost(overrides: Partial<TakeHost> = {}): TakeHost {
  return {
    isLandingCurrent: vi.fn(() => true),
    showLanding: vi.fn(),
    deliverPending: vi.fn(() => true),
    reportError: vi.fn(),
    ...overrides,
  };
}

describe("dictationTake", () => {
  beforeEach(() => {
    resetDictationTakeForTests();
    vi.clearAllMocks();
    transcribeWav.mockResolvedValue({ text: "hello", path: "/tmp/rec_1.wav" });
    vi.stubGlobal("window", {
      harness: {
        recording: {
          stopGlobalRecording: vi.fn(async () => {}),
          cancelGlobalSession: vi.fn(async () => {}),
        },
      },
    });
  });

  it("delivers to the landing's mounted surface with the recording path", async () => {
    const host = makeHost();
    wireTakeHost(host);
    const deliver = vi.fn();
    registerTakeHandler("chat:a", { deliver, onError: vi.fn() });

    await startMicTake(CHAT_A);
    expect(getTake()).toMatchObject({ source: "mic", phase: "recording", landing: CHAT_A });
    await stopTake();

    expect(host.showLanding).toHaveBeenCalledWith(CHAT_A);
    expect(deliver).toHaveBeenCalledWith("hello", {
      cleanupSkipped: undefined,
      recordingPath: "/tmp/rec_1.wav",
    });
    expect(host.deliverPending).not.toHaveBeenCalled();
    expect(getTake()).toBeNull();
  });

  it("keeps the take when its surface unmounts and lands it through the host", async () => {
    const host = makeHost();
    wireTakeHost(host);
    const unregister = registerTakeHandler("chat:a", { deliver: vi.fn(), onError: vi.fn() });

    await startMicTake(CHAT_A);
    unregister();
    expect(getTake()?.phase).toBe("recording");
    expect(recorder.cancel).not.toHaveBeenCalled();
    await stopTake();

    expect(host.showLanding).toHaveBeenCalledWith(CHAT_A);
    expect(host.deliverPending).toHaveBeenCalledWith(CHAT_A, "hello");
  });

  it("holds the transcript for a surface with no pending path until it mounts", async () => {
    wireTakeHost(makeHost({ deliverPending: vi.fn(() => false) }));
    await startMicTake({ surface: "tasks" });
    await stopTake();

    const deliver = vi.fn();
    registerTakeHandler("tasks", { deliver, onError: vi.fn() });
    expect(deliver).toHaveBeenCalledWith("hello", expect.objectContaining({ recordingPath: "/tmp/rec_1.wav" }));
  });

  it("reports a failed transcription to the surface, or the host when it is off screen", async () => {
    transcribeWav.mockResolvedValue({ error: "No speech detected." });
    const host = makeHost();
    wireTakeHost(host);
    const onError = vi.fn();
    registerTakeHandler("chat:a", { deliver: vi.fn(), onError });

    await startMicTake(CHAT_A);
    await stopTake();
    expect(onError).toHaveBeenCalledWith("No speech detected.");

    vi.mocked(host.isLandingCurrent).mockReturnValue(false);
    await startMicTake(CHAT_A);
    await stopTake();
    expect(host.reportError).toHaveBeenCalledWith("No speech detected.");
  });

  it("drops a cancelled take without delivering it", async () => {
    const host = makeHost();
    wireTakeHost(host);
    await startMicTake(CHAT_A);
    await cancelTake();

    expect(recorder.cancel).toHaveBeenCalled();
    expect(getTake()).toBeNull();
    expect(host.deliverPending).not.toHaveBeenCalled();
  });

  it("does not start a second take while one is active", async () => {
    await startMicTake(CHAT_A);
    await startMicTake({ surface: "tasks" });
    expect(recorder.start).toHaveBeenCalledTimes(1);
    expect(getTake()?.landing).toEqual(CHAT_A);
  });

  it("tracks an Fn take and stops it natively", async () => {
    beginFnTake(null);
    expect(getTake()).toMatchObject({ source: "fn", phase: "recording", landing: null });

    await stopTake();
    expect(window.harness.recording.stopGlobalRecording).toHaveBeenCalled();
    expect(getTake()?.phase).toBe("processing");

    endFnTake();
    expect(getTake()).toBeNull();

    markFnTakeProcessing();
    expect(getTake()).toMatchObject({ source: "fn", phase: "processing" });
  });

  it("lets an Fn take replace an in-app take", async () => {
    await startMicTake(CHAT_A);
    beginFnTake(null);
    expect(recorder.cancel).toHaveBeenCalled();
    expect(getTake()?.source).toBe("fn");
  });
});
