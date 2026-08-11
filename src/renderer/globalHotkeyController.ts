import { playCancelChime, playStartChime, playStopChime } from "./recordingUtils";
import type { Conversation } from "./sidebarUtils";

export type GlobalHotkeyOverlayPhase = "idle" | "recording" | "transcribing" | "failed";

export type GlobalHotkeyActions = {
  /** True while this Fn take uses the full-screen overlay (unfocused start). */
  setGlobalHotkeyOverlaySession: (active: boolean) => void;
  setGlobalHotkeyOverlayPhase: (phase: GlobalHotkeyOverlayPhase) => void;
  setGlobalHotkeyError: (message: string | null, recordingPath?: string | null) => void;
  setView: (view: "chat") => void;
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
  /** Current main-window surface (used to keep focused dictation in notes). */
  getView: () => string;
  /** Active writing-surface note, if any. */
  getActiveNoteId: () => string | null;
  /** Whether the current take is showing the overlay session. */
  getOverlaySession: () => boolean;
};

let actions: GlobalHotkeyActions | null = null;

export function wireGlobalHotkeyActions(next: GlobalHotkeyActions | null): void {
  actions = next;
}

/** Reset module state (tests only). */
export function resetGlobalHotkeyControllerForTests(): void {
  actions = null;
}

function clearOverlay(): void {
  actions?.setGlobalHotkeyOverlaySession(false);
  actions?.setGlobalHotkeyOverlayPhase("idle");
  actions?.setGlobalHotkeyError(null, null);
}

export function createGlobalHotkeyController(): () => void {
  const unsubStarted = window.harness.recording.onGlobalRecordingStarted(({ focused }) => {
    actions?.setGlobalHotkeyError(null, null);
    if (focused) {
      actions?.setGlobalHotkeyOverlaySession(false);
      actions?.setGlobalHotkeyOverlayPhase("idle");
    } else {
      actions?.setGlobalHotkeyOverlaySession(true);
      actions?.setGlobalHotkeyOverlayPhase("recording");
    }
    void playStartChime();
  });

  const unsubStopped = window.harness.recording.onGlobalRecordingStopped(() => {
    // Overlay stays up until transcribing / ready / error; only chime here.
    void playStopChime();
  });

  const unsubTranscribing = window.harness.recording.onGlobalRecordingTranscribing(({ recordingPath }) => {
    if (!actions?.getOverlaySession()) return;
    if (recordingPath) {
      actions.setGlobalHotkeyError(null, recordingPath);
    }
    actions.setGlobalHotkeyOverlayPhase("transcribing");
  });

  const unsubCancelled = window.harness.recording.onGlobalRecordingCancelled(() => {
    clearOverlay();
    void playCancelChime();
  });

  const unsubError = window.harness.recording.onGlobalRecordingError(({ message, recordingPath }) => {
    if (actions?.getOverlaySession()) {
      actions.setGlobalHotkeyError(message, recordingPath ?? null);
      actions.setGlobalHotkeyOverlayPhase("failed");
      return;
    }
    // Focused path: lightweight chip (App auto-clears).
    actions?.setGlobalHotkeyOverlayPhase("idle");
    actions?.setGlobalHotkeyError(message, null);
  });

  const unsubTranscriptReady = window.harness.recording.onGlobalTranscriptReady((text) => {
    clearOverlay();
    if (actions?.getView() === "notes" && actions.getActiveNoteId()) {
      actions.setPendingNoteHotkeyText(text);
      return;
    }
    actions?.setView("chat");
    if (!actions?.getConversationId()) {
      actions?.setConversationId(null);
    }
    actions?.setFocusComposerNonce((n) => n + 1);
    actions?.setPendingHotkeyDraftOnly(false);
    actions?.setPendingHotkeyText(text);
  });

  const unsubTranscriptDelivered = window.harness.recording.onGlobalTranscriptDelivered(
    (conversationId) => {
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
    unsubTranscribing();
    unsubCancelled();
    unsubError();
    unsubTranscriptReady();
    unsubTranscriptDelivered();
  };
}

export function initGlobalHotkeyController(): () => void {
  return createGlobalHotkeyController();
}
