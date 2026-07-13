import { playCancelChime, playStartChime, playStopChime } from "./recordingUtils";
import type { Conversation } from "./sidebarUtils";

export type GlobalHotkeyActions = {
  setGlobalHotkeyRecording: (active: boolean) => void;
  setGlobalHotkeyError: (message: string | null) => void;
  setView: (view: "chat") => void;
  setConversationId: (id: string | null) => void;
  setFocusComposerNonce: (updater: (n: number) => number) => void;
  setPendingHotkeyText: (text: string | null) => void;
  setPendingHotkeyDraftOnly: (value: boolean) => void;
  setConversations: (updater: (prev: Conversation[]) => Conversation[]) => void;
  loadConversations: () => Promise<void>;
  getConversationId: () => string | null;
};

let actions: GlobalHotkeyActions | null = null;

export function wireGlobalHotkeyActions(next: GlobalHotkeyActions | null): void {
  actions = next;
}

/** Reset module state (tests only). */
export function resetGlobalHotkeyControllerForTests(): void {
  actions = null;
}

export function createGlobalHotkeyController(): () => void {
  const unsubStarted = window.harness.recording.onGlobalRecordingStarted(() => {
    actions?.setGlobalHotkeyError(null);
    actions?.setGlobalHotkeyRecording(true);
    void playStartChime();
  });

  const unsubStopped = window.harness.recording.onGlobalRecordingStopped(() => {
    actions?.setGlobalHotkeyRecording(false);
    void playStopChime();
  });

  const unsubCancelled = window.harness.recording.onGlobalRecordingCancelled(() => {
    actions?.setGlobalHotkeyRecording(false);
    void playCancelChime();
  });

  const unsubError = window.harness.recording.onGlobalRecordingError((message) => {
    actions?.setGlobalHotkeyRecording(false);
    actions?.setGlobalHotkeyError(message);
  });

  const unsubTranscriptReady = window.harness.recording.onGlobalTranscriptReady((text) => {
    actions?.setGlobalHotkeyError(null);
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
      actions?.setGlobalHotkeyError(null);
      actions?.setView("chat");
      actions?.setConversationId(conversationId);
      void actions?.loadConversations();
    },
  );

  return () => {
    unsubStarted();
    unsubStopped();
    unsubCancelled();
    unsubError();
    unsubTranscriptReady();
    unsubTranscriptDelivered();
  };
}

export function initGlobalHotkeyController(): () => void {
  return createGlobalHotkeyController();
}
