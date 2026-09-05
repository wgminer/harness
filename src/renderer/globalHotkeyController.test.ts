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
  let startedCb: ((info: { focused: boolean }) => void) | null = null;
  let stoppedCb: (() => void) | null = null;
  let transcribingCb: ((info: { recordingPath?: string }) => void) | null = null;
  let cancelledCb: (() => void) | null = null;
  let errorCb: ((info: { message: string; recordingPath?: string }) => void) | null = null;
  let transcriptReadyCb: ((text: string) => void) | null = null;
  let transcriptDeliveredCb: ((conversationId: string) => void) | null = null;
  let teardown: (() => void) | null = null;
  let actions: GlobalHotkeyActions;
  let overlaySession = false;

  beforeEach(() => {
    resetGlobalHotkeyControllerForTests();
    vi.clearAllMocks();
    overlaySession = false;

    startedCb = null;
    stoppedCb = null;
    transcribingCb = null;
    cancelledCb = null;
    errorCb = null;
    transcriptReadyCb = null;
    transcriptDeliveredCb = null;

    const harness = {
      recording: {
        onGlobalRecordingStarted: vi.fn((cb: (info: { focused: boolean }) => void) => {
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
        onGlobalRecordingTranscribing: vi.fn(
          (cb: (info: { recordingPath?: string }) => void) => {
            transcribingCb = cb;
            return () => {
              transcribingCb = null;
            };
          },
        ),
        onGlobalRecordingCancelled: vi.fn((cb: () => void) => {
          cancelledCb = cb;
          return () => {
            cancelledCb = null;
          };
        }),
        onGlobalRecordingError: vi.fn(
          (cb: (info: { message: string; recordingPath?: string }) => void) => {
            errorCb = cb;
            return () => {
              errorCb = null;
            };
          },
        ),
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
      setGlobalHotkeyOverlaySession: vi.fn((active: boolean) => {
        overlaySession = active;
      }),
      setGlobalHotkeyOverlayPhase: vi.fn(),
      setGlobalHotkeyError: vi.fn(),
      setView: vi.fn(),
      setConversationId: vi.fn(),
      setFocusComposerNonce: vi.fn(),
      setPendingHotkeyText: vi.fn(),
      setPendingHotkeyDraftOnly: vi.fn(),
      setPendingNoteHotkeyText: vi.fn(),
      setConversations: vi.fn(),
      refreshConversations: vi.fn(async () => {}),
      markTitleAwaiting: vi.fn(),
      getConversationId: vi.fn(() => "conv-existing"),
      getView: vi.fn(() => "chat"),
      getActiveNoteId: vi.fn(() => null),
      setActiveNoteId: vi.fn(),
      getOverlaySession: vi.fn(() => overlaySession),
    };
    wireGlobalHotkeyActions(actions);
    teardown = createGlobalHotkeyController();
  });

  afterEach(() => {
    teardown?.();
    resetGlobalHotkeyControllerForTests();
    delete (globalThis as { window?: unknown }).window;
  });

  it("shows recording overlay only when unfocused", () => {
    startedCb?.({ focused: false });
    expect(actions.setGlobalHotkeyOverlaySession).toHaveBeenCalledWith(true);
    expect(actions.setGlobalHotkeyOverlayPhase).toHaveBeenCalledWith("recording");
    expect(mockedPlayStartChime).toHaveBeenCalled();

    startedCb?.({ focused: true });
    expect(actions.setGlobalHotkeyOverlaySession).toHaveBeenCalledWith(false);
    expect(actions.setGlobalHotkeyOverlayPhase).toHaveBeenCalledWith("idle");
  });

  it("plays stop chime without clearing overlay on stopped", () => {
    startedCb?.({ focused: false });
    stoppedCb?.();
    expect(mockedPlayStopChime).toHaveBeenCalled();
    expect(actions.setGlobalHotkeyOverlayPhase).not.toHaveBeenCalledWith("idle");
  });

  it("moves unfocused overlay to transcribing", () => {
    startedCb?.({ focused: false });
    transcribingCb?.({ recordingPath: "/tmp/rec.wav" });
    expect(actions.setGlobalHotkeyOverlayPhase).toHaveBeenCalledWith("transcribing");
    expect(actions.setGlobalHotkeyError).toHaveBeenCalledWith(null, "/tmp/rec.wav");
  });

  it("plays cancel chime and clears overlay on cancelled", () => {
    startedCb?.({ focused: false });
    cancelledCb?.();
    expect(actions.setGlobalHotkeyOverlayPhase).toHaveBeenCalledWith("idle");
    expect(mockedPlayCancelChime).toHaveBeenCalled();
  });

  it("shows failed phase for overlay-session errors", () => {
    startedCb?.({ focused: false });
    errorCb?.({ message: "no speech", recordingPath: "/tmp/rec.wav" });
    expect(actions.setGlobalHotkeyOverlayPhase).toHaveBeenCalledWith("failed");
    expect(actions.setGlobalHotkeyError).toHaveBeenCalledWith("no speech", "/tmp/rec.wav");
  });

  it("uses lightweight error for focused path", () => {
    startedCb?.({ focused: true });
    errorCb?.({ message: "mic denied" });
    expect(actions.setGlobalHotkeyOverlayPhase).toHaveBeenCalledWith("idle");
    expect(actions.setGlobalHotkeyError).toHaveBeenCalledWith("mic denied", null);
  });

  it("delivers focused transcripts into the composer", () => {
    transcriptReadyCb?.("hello world");
    expect(actions.setView).toHaveBeenCalledWith("chat");
    expect(actions.setFocusComposerNonce).toHaveBeenCalled();
    expect(actions.setPendingHotkeyText).toHaveBeenCalledWith("hello world");
    expect(actions.setPendingNoteHotkeyText).not.toHaveBeenCalled();
  });

  it("delivers focused transcripts into an open note without switching views", () => {
    vi.mocked(actions.getView).mockReturnValue("notes");
    vi.mocked(actions.getActiveNoteId).mockReturnValue("note-1");
    transcriptReadyCb?.("note dictation");
    expect(actions.setView).toHaveBeenCalledWith("notes");
    expect(actions.setActiveNoteId).toHaveBeenCalledWith("note-1");
    expect(actions.setPendingHotkeyText).not.toHaveBeenCalled();
    expect(actions.setPendingNoteHotkeyText).toHaveBeenCalledWith("note dictation");
  });

  it("falls back to chat when notes view has no active note", () => {
    vi.mocked(actions.getView).mockReturnValue("notes");
    vi.mocked(actions.getActiveNoteId).mockReturnValue(null);
    transcriptReadyCb?.("fallback");
    expect(actions.setView).toHaveBeenCalledWith("chat");
    expect(actions.setPendingHotkeyText).toHaveBeenCalledWith("fallback");
    expect(actions.setPendingNoteHotkeyText).not.toHaveBeenCalled();
  });

  it("pins chat landing at record start when the user navigates to notes", () => {
    startedCb?.({ focused: true });
    vi.mocked(actions.getView).mockReturnValue("notes");
    vi.mocked(actions.getActiveNoteId).mockReturnValue("note-1");
    transcriptReadyCb?.("stay in chat");
    expect(actions.setView).toHaveBeenCalledWith("chat");
    expect(actions.setConversationId).toHaveBeenCalledWith("conv-existing");
    expect(actions.setPendingHotkeyText).toHaveBeenCalledWith("stay in chat");
    expect(actions.setPendingNoteHotkeyText).not.toHaveBeenCalled();
  });

  it("pins note landing at record start when the user navigates to chat", () => {
    vi.mocked(actions.getView).mockReturnValue("notes");
    vi.mocked(actions.getActiveNoteId).mockReturnValue("note-1");
    startedCb?.({ focused: true });
    vi.mocked(actions.getView).mockReturnValue("chat");
    vi.mocked(actions.getActiveNoteId).mockReturnValue(null);
    vi.mocked(actions.getConversationId).mockReturnValue("conv-other");
    transcriptReadyCb?.("stay in note");
    expect(actions.setView).toHaveBeenCalledWith("notes");
    expect(actions.setActiveNoteId).toHaveBeenCalledWith("note-1");
    expect(actions.setPendingNoteHotkeyText).toHaveBeenCalledWith("stay in note");
    expect(actions.setPendingHotkeyText).not.toHaveBeenCalled();
  });

  it("selects conversation on unfocused delivery", () => {
    transcriptDeliveredCb?.("conv-new");
    expect(actions.setView).toHaveBeenCalledWith("chat");
    expect(actions.setConversationId).toHaveBeenCalledWith("conv-new");
    expect(actions.markTitleAwaiting).toHaveBeenCalledWith("conv-new");
    expect(actions.setConversations).toHaveBeenCalled();
    expect(actions.refreshConversations).toHaveBeenCalled();
  });
});
