import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGlobalHotkeyController,
  resetGlobalHotkeyControllerForTests,
  wireGlobalHotkeyActions,
  type GlobalHotkeyActions,
} from "./globalHotkeyController";
import * as recordingUtils from "./recordingUtils";

vi.mock("./recordingUtils", () => ({
  playStartChime: vi.fn(async () => {}),
  playStopChime: vi.fn(async () => {}),
  playCancelChime: vi.fn(async () => {}),
}));

const mockedPlayStartChime = vi.mocked(recordingUtils.playStartChime);
const mockedPlayStopChime = vi.mocked(recordingUtils.playStopChime);
const mockedPlayCancelChime = vi.mocked(recordingUtils.playCancelChime);

describe("globalHotkeyController", () => {
  let startedCb: (() => void) | null = null;
  let stoppedCb: (() => void) | null = null;
  let cancelledCb: (() => void) | null = null;
  let errorCb: ((message: string) => void) | null = null;
  let transcriptReadyCb: ((text: string) => void) | null = null;
  let transcriptDeliveredCb: ((conversationId: string) => void) | null = null;
  let teardown: (() => void) | null = null;
  let actions: GlobalHotkeyActions;

  beforeEach(() => {
    resetGlobalHotkeyControllerForTests();
    vi.clearAllMocks();

    startedCb = null;
    stoppedCb = null;
    cancelledCb = null;
    errorCb = null;
    transcriptReadyCb = null;
    transcriptDeliveredCb = null;

    const harness = {
      recording: {
        onGlobalRecordingStarted: vi.fn((cb: () => void) => {
          startedCb = cb;
          return () => {
            startedCb = null;
          };
        }),
        onGlobalRecordingStopped: vi.fn((cb: () => void) => {
          stoppedCb = cb;
          return () => {
            stoppedCb = null;
          };
        }),
        onGlobalRecordingCancelled: vi.fn((cb: () => void) => {
          cancelledCb = cb;
          return () => {
            cancelledCb = null;
          };
        }),
        onGlobalRecordingError: vi.fn((cb: (message: string) => void) => {
          errorCb = cb;
          return () => {
            errorCb = null;
          };
        }),
        onGlobalTranscriptReady: vi.fn((cb: (text: string) => void) => {
          transcriptReadyCb = cb;
          return () => {
            transcriptReadyCb = null;
          };
        }),
        onGlobalTranscriptDelivered: vi.fn((cb: (conversationId: string) => void) => {
          transcriptDeliveredCb = cb;
          return () => {
            transcriptDeliveredCb = null;
          };
        }),
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

  it("shows recording overlay and plays start chime on started event", () => {
    startedCb?.();
    expect(actions.setGlobalHotkeyRecording).toHaveBeenCalledWith(true);
    expect(actions.setGlobalHotkeyError).toHaveBeenCalledWith(null);
    expect(mockedPlayStartChime).toHaveBeenCalled();
  });

  it("hides overlay and plays stop chime on stopped event", () => {
    stoppedCb?.();
    expect(actions.setGlobalHotkeyRecording).toHaveBeenCalledWith(false);
    expect(mockedPlayStopChime).toHaveBeenCalled();
  });

  it("plays cancel chime on cancelled event", () => {
    cancelledCb?.();
    expect(actions.setGlobalHotkeyRecording).toHaveBeenCalledWith(false);
    expect(mockedPlayCancelChime).toHaveBeenCalled();
  });

  it("reports errors from global-recording-error", () => {
    errorCb?.("mic denied");
    expect(actions.setGlobalHotkeyRecording).toHaveBeenCalledWith(false);
    expect(actions.setGlobalHotkeyError).toHaveBeenCalledWith("mic denied");
  });

  it("delivers focused transcripts into the composer", () => {
    transcriptReadyCb?.("hello world");
    expect(actions.setView).toHaveBeenCalledWith("chat");
    expect(actions.setFocusComposerNonce).toHaveBeenCalled();
    expect(actions.setPendingHotkeyText).toHaveBeenCalledWith("hello world");
  });

  it("selects conversation on unfocused delivery", () => {
    transcriptDeliveredCb?.("conv-new");
    expect(actions.setView).toHaveBeenCalledWith("chat");
    expect(actions.setConversationId).toHaveBeenCalledWith("conv-new");
    expect(actions.loadConversations).toHaveBeenCalled();
  });
});
