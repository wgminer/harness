import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGlobalHotkeyController,
  resetGlobalHotkeyControllerForTests,
  wireGlobalHotkeyActions,
  type GlobalHotkeyActions,
} from "./globalHotkeyController";
import type { Recorder } from "./useRecorder";
import {
  deliverTranscriptFocused,
  deliverTranscriptUnfocused,
  finishGlobalSession,
  transcribeWav,
} from "./recordingPipeline";

vi.mock("./recordingPipeline", () => ({
  transcribeWav: vi.fn(async () => ({ text: "hello world" })),
  deliverTranscriptFocused: vi.fn((text: string) => ({ kind: "focused", text })),
  deliverTranscriptUnfocused: vi.fn(async () => {}),
  finishGlobalSession: vi.fn(async () => {}),
}));

vi.mock("./recordingUtils", () => ({
  playCancelChime: vi.fn(async () => {}),
}));

const mockedTranscribeWav = vi.mocked(transcribeWav);
const mockedDeliverUnfocused = vi.mocked(deliverTranscriptUnfocused);
const mockedFinishGlobalSession = vi.mocked(finishGlobalSession);

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("globalHotkeyController", () => {
  let startCb: (() => void) | null = null;
  let stopCb: ((wasFocused: boolean) => void) | null = null;
  let teardown: (() => void) | null = null;
  let actions: GlobalHotkeyActions;

  beforeEach(() => {
    resetGlobalHotkeyControllerForTests();
    vi.clearAllMocks();

    startCb = null;
    stopCb = null;

    const harness = {
      env: {
        isHarnessE2E: vi.fn(async () => false),
      },
      recording: {
        onStartSilent: vi.fn((cb: () => void) => {
          startCb = cb;
          return () => {
            startCb = null;
          };
        }),
        onStopAndPaste: vi.fn((cb: (wasFocused: boolean) => void) => {
          stopCb = cb;
          return () => {
            stopCb = null;
          };
        }),
        onCancel: vi.fn(() => () => {}),
        startFailed: vi.fn(async () => {}),
        done: vi.fn(async () => {}),
        pasteText: vi.fn(async () => {}),
        transcribe: vi.fn(async () => ({ text: "hello world" })),
        saveWav: vi.fn(async () => ({ path: "/tmp/test.wav" })),
      },
      memory: {
        createConversation: vi.fn(async () => "conv-1"),
        appendMessage: vi.fn(async () => {}),
        markVoiceDictationSession: vi.fn(async () => "Dictation"),
      },
    };

    (globalThis as { window?: { harness: typeof harness } }).window = { harness };

    actions = {
      setGlobalHotkeyRecording: vi.fn(),
      setGlobalHotkeyError: vi.fn(),
      setView: vi.fn(),
      setConversationId: vi.fn(),
      setFocusComposerNonce: vi.fn(),
      setPendingHotkeyText: vi.fn(),
      setPendingHotkeyDraftOnly: vi.fn(),
      setConversations: vi.fn(),
      loadConversations: vi.fn(async () => {}),
      getConversationId: vi.fn(() => "conv-existing"),
    };
    wireGlobalHotkeyActions(actions);
    teardown = createGlobalHotkeyController();
  });

  afterEach(() => {
    teardown?.();
    resetGlobalHotkeyControllerForTests();
    delete (globalThis as { window?: unknown }).window;
  });

  it("shows recording overlay before start() resolves", async () => {
    const startDeferred = createDeferred<void>();
    const stopDeferred = createDeferred<ArrayBuffer>();
    let stopCalls = 0;

    const recorder: Recorder = {
      start: vi.fn(() => startDeferred.promise),
      stop: vi.fn(() => {
        stopCalls += 1;
        return stopDeferred.promise;
      }),
    };

    teardown?.();
    teardown = createGlobalHotkeyController({ createRecorder: () => recorder });

    startCb?.();
    expect(actions.setGlobalHotkeyRecording).toHaveBeenCalledWith(true);

    startDeferred.resolve();
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalled());

    stopCb?.(false);
    expect(actions.setGlobalHotkeyRecording).toHaveBeenCalledWith(false);
    expect(stopCalls).toBe(0);

    stopDeferred.resolve(new ArrayBuffer(8));
    await vi.waitFor(() => expect(stopCalls).toBe(1));
  });

  it("waits for in-flight start before stop()", async () => {
    const startDeferred = createDeferred<void>();
    const recorder: Recorder = {
      start: vi.fn(() => startDeferred.promise),
      stop: vi.fn(async () => new ArrayBuffer(8)),
    };

    teardown?.();
    teardown = createGlobalHotkeyController({ createRecorder: () => recorder });

    startCb?.();
    stopCb?.(false);
    expect(recorder.stop).not.toHaveBeenCalled();

    startDeferred.resolve();
    await vi.waitFor(() => expect(recorder.stop).toHaveBeenCalled());
    expect(mockedTranscribeWav).toHaveBeenCalled();
  });

  it("clears recording overlay before async transcribe completes", async () => {
    const transcribeDeferred = createDeferred<{ text: string }>();
    mockedTranscribeWav.mockImplementationOnce(() => transcribeDeferred.promise);

    const recorder: Recorder = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => new ArrayBuffer(8)),
    };

    teardown?.();
    teardown = createGlobalHotkeyController({ createRecorder: () => recorder });

    startCb?.();
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalled());

    vi.mocked(actions.setGlobalHotkeyRecording).mockClear();
    stopCb?.(false);
    expect(actions.setGlobalHotkeyRecording).toHaveBeenCalledWith(false);
    expect(mockedTranscribeWav).not.toHaveBeenCalled();

    transcribeDeferred.resolve({ text: "hello world" });
    await vi.waitFor(() => expect(mockedTranscribeWav).toHaveBeenCalled());
    await vi.waitFor(() => expect(mockedFinishGlobalSession).toHaveBeenCalled());
  });

  it("delivers unfocused transcripts without bumping focus nonce", async () => {
    const recorder: Recorder = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => new ArrayBuffer(8)),
    };

    teardown?.();
    teardown = createGlobalHotkeyController({ createRecorder: () => recorder });

    startCb?.();
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalled());
    stopCb?.(false);
    await vi.waitFor(() => expect(mockedDeliverUnfocused).toHaveBeenCalled());
    expect(actions.setFocusComposerNonce).not.toHaveBeenCalled();
    expect(actions.setPendingHotkeyText).not.toHaveBeenCalled();
  });

  it("delivers focused transcripts into the composer", async () => {
    const recorder: Recorder = {
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => new ArrayBuffer(8)),
    };

    teardown?.();
    teardown = createGlobalHotkeyController({ createRecorder: () => recorder });

    startCb?.();
    await vi.waitFor(() => expect(recorder.start).toHaveBeenCalled());
    stopCb?.(true);
    await vi.waitFor(() => expect(deliverTranscriptFocused).toHaveBeenCalled());
    expect(actions.setFocusComposerNonce).toHaveBeenCalled();
    expect(actions.setPendingHotkeyText).toHaveBeenCalledWith("hello world");
  });

  it("reports start failure and skips transcription on stop", async () => {
    const recorder: Recorder = {
      start: vi.fn(async () => {
        throw new Error("mic denied");
      }),
      stop: vi.fn(async () => new ArrayBuffer(8)),
    };

    teardown?.();
    teardown = createGlobalHotkeyController({ createRecorder: () => recorder });

    startCb?.();
    await vi.waitFor(() =>
      expect(window.harness.recording.startFailed).toHaveBeenCalledWith("mic denied"),
    );
    expect(actions.setGlobalHotkeyRecording).toHaveBeenLastCalledWith(false);

    stopCb?.(false);
    await Promise.resolve();
    expect(recorder.stop).not.toHaveBeenCalled();
    expect(mockedTranscribeWav).not.toHaveBeenCalled();
  });
});
