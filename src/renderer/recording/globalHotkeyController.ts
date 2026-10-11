import type { Conversation } from "../sidebar/sidebarUtils";
import {
  beginFnTake,
  endFnTake,
  markFnTakeProcessing,
  setTakeLevel,
  wireTakeHost,
  type TakeLanding,
} from "./dictationTake";

export type GlobalHotkeyOverlayPhase = "idle" | "recording" | "transcribing" | "failed";

export type GlobalHotkeyActions = {
  /** True while this Fn take started unfocused (Rust lands it in a new dictation). */
  setGlobalHotkeyOverlaySession: (active: boolean) => void;
  setGlobalHotkeyOverlayPhase: (phase: GlobalHotkeyOverlayPhase) => void;
  setGlobalHotkeyError: (
    message: string | null,
    recordingPath?: string | null,
    needsAccessibility?: boolean,
  ) => void;
  setView: (view: "chat" | "notes" | "tasks") => void;
  setConversationId: (id: string | null) => void;
  setFocusComposerNonce: (updater: (n: number) => number) => void;
  setPendingHotkeyText: (text: string | null) => void;
  setPendingHotkeyDraftOnly: (value: boolean) => void;
  /** Focused Fn while the writing surface is open — insert at note cursor. */
  setPendingNoteHotkeyText: (text: string | null) => void;
  setConversations: (updater: (prev: Conversation[]) => Conversation[]) => void;
  refreshConversations: () => Promise<void>;
  markTitleAwaiting: (id: string) => void;
  getConversationId: () => string | null;
  /** Current main-window surface (used to pin focused dictation at start). */
  getView: () => string;
  /** Active writing-surface note, if any. */
  getActiveNoteId: () => string | null;
  /** Restore a pinned note after the user navigates during the take. */
  setActiveNoteId: (id: string | null) => void;
  /** Whether the current take is showing the overlay session. */
  getOverlaySession: () => boolean;
};

let actions: GlobalHotkeyActions | null = null;
let focusedLanding: TakeLanding | null = null;

export function wireGlobalHotkeyActions(next: GlobalHotkeyActions | null): void {
  actions = next;
  wireTakeHost(
    next && {
      isLandingCurrent,
      showLanding,
      deliverPending: (landing, text) => {
        if (landing.surface === "tasks") return false;
        deliverToLanding(landing, text);
        return true;
      },
      reportError: (message) => actions?.setGlobalHotkeyError(message, null),
    },
  );
}

/** Reset module state (tests only). */
export function resetGlobalHotkeyControllerForTests(): void {
  actions = null;
  focusedLanding = null;
}

function pinFocusedLanding(): void {
  if (actions?.getView() === "notes") {
    const noteId = actions.getActiveNoteId();
    if (noteId) {
      focusedLanding = { surface: "note", noteId };
      return;
    }
  }
  focusedLanding = {
    surface: "chat",
    conversationId: actions?.getConversationId() ?? null,
  };
}

function clearFocusedLanding(): void {
  focusedLanding = null;
}

function isLandingCurrent(landing: TakeLanding): boolean {
  if (landing.surface === "note") {
    return actions?.getView() === "notes" && actions.getActiveNoteId() === landing.noteId;
  }
  if (landing.surface === "tasks") return actions?.getView() === "tasks";
  return actions?.getView() === "chat" && actions.getConversationId() === landing.conversationId;
}

/** Bring the surface a take was pinned to back on screen. */
function showLanding(landing: TakeLanding): void {
  if (landing.surface === "note") {
    actions?.setView("notes");
    actions?.setActiveNoteId(landing.noteId);
    return;
  }
  if (landing.surface === "tasks") {
    actions?.setView("tasks");
    return;
  }
  actions?.setView("chat");
  actions?.setConversationId(landing.conversationId);
}

function deliverFocusedTranscript(text: string): void {
  const landing = focusedLanding;
  clearFocusedLanding();
  deliverToLanding(landing, text);
}

function deliverToLanding(landing: TakeLanding | null, text: string): void {
  const toNote =
    landing?.surface === "note"
      ? landing.noteId
      : landing == null && actions?.getView() === "notes"
        ? actions.getActiveNoteId()
        : null;
  if (toNote) {
    actions?.setView("notes");
    actions?.setActiveNoteId(toNote);
    actions?.setPendingNoteHotkeyText(text);
    return;
  }
  actions?.setView("chat");
  if (landing?.surface === "chat") {
    actions?.setConversationId(landing.conversationId);
  } else if (!actions?.getConversationId()) {
    actions?.setConversationId(null);
  }
  actions?.setFocusComposerNonce((n) => n + 1);
  actions?.setPendingHotkeyDraftOnly(false);
  actions?.setPendingHotkeyText(text);
}

function clearOverlay(): void {
  actions?.setGlobalHotkeyOverlaySession(false);
  actions?.setGlobalHotkeyOverlayPhase("idle");
  actions?.setGlobalHotkeyError(null, null);
}

export function createGlobalHotkeyController(): () => void {
  // Start / stop / done / cancel cues play natively in Rust alongside these events.
  const unsubStarted = window.harness.recording.onGlobalRecordingStarted(({ focused }) => {
    actions?.setGlobalHotkeyError(null, null);
    if (focused) {
      pinFocusedLanding();
      actions?.setGlobalHotkeyOverlaySession(false);
      actions?.setGlobalHotkeyOverlayPhase("idle");
    } else {
      clearFocusedLanding();
      actions?.setGlobalHotkeyOverlaySession(true);
      actions?.setGlobalHotkeyOverlayPhase("recording");
    }
    beginFnTake(focusedLanding);
  });

  const unsubStopped = window.harness.recording.onGlobalRecordingStopped(() => {
    markFnTakeProcessing();
  });

  const unsubLevel = window.harness.recording.onGlobalRecordingLevel(setTakeLevel);

  const unsubTranscribing = window.harness.recording.onGlobalRecordingTranscribing(({ recordingPath }) => {
    markFnTakeProcessing();
    if (!actions?.getOverlaySession()) return;
    if (recordingPath) {
      actions.setGlobalHotkeyError(null, recordingPath);
    }
    actions.setGlobalHotkeyOverlayPhase("transcribing");
  });

  const unsubCancelled = window.harness.recording.onGlobalRecordingCancelled(() => {
    endFnTake();
    clearFocusedLanding();
    clearOverlay();
  });

  const unsubRetrying = window.harness.recording.onGlobalRecordingRetrying(() => {
    markFnTakeProcessing();
    if (actions?.getOverlaySession()) return;
    actions?.setGlobalHotkeyError(null, null);
    actions?.setGlobalHotkeyOverlayPhase("transcribing");
  });

  const unsubError = window.harness.recording.onGlobalRecordingError((info) => {
    const { message, recordingPath, needsAccessibility } = info;
    endFnTake();
    clearFocusedLanding();
    if (actions?.getOverlaySession()) {
      actions.setGlobalHotkeyError(message, recordingPath ?? null, needsAccessibility === true);
      actions.setGlobalHotkeyOverlayPhase("failed");
      return;
    }
    // Focused path: lightweight chip (App auto-clears unless it can retry).
    actions?.setGlobalHotkeyOverlayPhase("idle");
    actions?.setGlobalHotkeyError(message, recordingPath ?? null);
  });

  const unsubTranscriptReady = window.harness.recording.onGlobalTranscriptReady((text) => {
    endFnTake();
    clearOverlay();
    deliverFocusedTranscript(text);
  });

  const unsubTranscriptDelivered = window.harness.recording.onGlobalTranscriptDelivered(
    (conversationId) => {
      endFnTake();
      clearFocusedLanding();
      clearOverlay();
      actions?.setView("chat");
      actions?.setConversationId(conversationId);
      actions?.markTitleAwaiting(conversationId);
      // Seed sidebar immediately so selection is not dropped before list refresh.
      actions?.setConversations((prev) => {
        if (prev.some((c) => c.id === conversationId)) {
          return prev.map((c) =>
            c.id === conversationId
              ? { ...c, hasMessages: true, sessionKind: "dictation" as const }
              : c,
          );
        }
        return [
          {
            id: conversationId,
            title: null,
            createdAt: Date.now(),
            sessionKind: "dictation",
            hasMessages: true,
          },
          ...prev,
        ];
      });
      // refreshConversations preserves the selected id; loadConversations would
      // reset to compose when openToComposeOnLaunch is on.
      void actions?.refreshConversations();
    },
  );

  return () => {
    unsubStarted();
    unsubStopped();
    unsubLevel();
    unsubTranscribing();
    unsubCancelled();
    unsubRetrying();
    unsubError();
    unsubTranscriptReady();
    unsubTranscriptDelivered();
  };
}

export function initGlobalHotkeyController(): () => void {
  return createGlobalHotkeyController();
}
