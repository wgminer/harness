import {
  deliverTranscriptFocused,
  deliverTranscriptUnfocused,
  finishGlobalSession,
  transcribeWav,
} from "./recordingPipeline";
import { playCancelChime } from "./recordingUtils";
import type { Conversation } from "./sidebarUtils";
import { createRecorder, type Recorder } from "./useRecorder";

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

let hotkeyRecorder: Recorder = createRecorder();
let hotkeyRecording = false;
let hotkeyCancelled = false;
let hotkeyStartPromise: Promise<void> | null = null;

export function wireGlobalHotkeyActions(next: GlobalHotkeyActions | null): void {
  actions = next;
}

/** Reset module state (tests only). */
export function resetGlobalHotkeyControllerForTests(): void {
  hotkeyRecorder = createRecorder();
  hotkeyRecording = false;
  hotkeyCancelled = false;
  hotkeyStartPromise = null;
  actions = null;
}

export type GlobalHotkeyControllerDeps = {
  createRecorder?: () => Recorder;
};

export function createGlobalHotkeyController(
  deps: GlobalHotkeyControllerDeps = {},
): () => void {
  if (deps.createRecorder) {
    hotkeyRecorder = deps.createRecorder();
  }

  const unsubStart = window.harness.recording.onStartSilent(async () => {
    hotkeyCancelled = false;
    actions?.setGlobalHotkeyRecording(true);
    actions?.setGlobalHotkeyError(null);

    const startWork = async () => {
      if (await window.harness.env.isHarnessE2E()) {
        hotkeyRecording = true;
        return;
      }
      await hotkeyRecorder.start();
      hotkeyRecording = true;
    };

    hotkeyStartPromise = startWork();
    try {
      await hotkeyStartPromise;
    } catch (err) {
      hotkeyRecording = false;
      actions?.setGlobalHotkeyRecording(false);
      const message = err instanceof Error ? err.message : "Recording failed.";
      actions?.setGlobalHotkeyError(message);
      await window.harness.recording.startFailed(message);
    } finally {
      hotkeyStartPromise = null;
    }
  });

  const unsubStop = window.harness.recording.onStopAndPaste(async (wasFocused: boolean) => {
    const wasRecordingInitially = hotkeyRecording;
    hotkeyRecording = false;
    actions?.setGlobalHotkeyRecording(false);
    const cancelled = () => hotkeyCancelled;

    const reportError = (message: string) => {
      actions?.setGlobalHotkeyError(message);
    };

    try {
      if (hotkeyStartPromise) {
        await hotkeyStartPromise;
      }
      const wasRecording = wasRecordingInitially || hotkeyRecording;
      hotkeyRecording = false;
      if (!wasRecording && !(await window.harness.env.isHarnessE2E())) {
        return;
      }
      const wav = (await window.harness.env.isHarnessE2E())
        ? new ArrayBuffer(0)
        : await hotkeyRecorder.stop();
      if (cancelled()) return;
      const result = await transcribeWav(wav);
      if (cancelled()) return;
      if ("error" in result) {
        reportError(result.error);
        return;
      }
      const text = result.text.trim();
      if (!text) {
        reportError("No speech was detected in the recording.");
        return;
      }
      actions?.setGlobalHotkeyError(null);
      if (wasFocused) {
        const delivered = deliverTranscriptFocused(text);
        actions?.setView("chat");
        if (!actions?.getConversationId()) {
          actions?.setConversationId(null);
        }
        actions?.setFocusComposerNonce((n) => n + 1);
        actions?.setPendingHotkeyDraftOnly(false);
        actions?.setPendingHotkeyText(delivered.text);
      } else {
        await deliverTranscriptUnfocused(text, {
          onConversationCreated: (conversation) => {
            actions?.setConversations((prev) => [conversation, ...prev]);
          },
          onConversationSelected: (id) => actions?.setConversationId(id),
          refreshConversations: () => actions?.loadConversations() ?? Promise.resolve(),
        });
        actions?.setView("chat");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Recording failed.";
      reportError(message);
    } finally {
      if (!cancelled()) {
        await finishGlobalSession();
      }
    }
  });

  const unsubCancel = window.harness.recording.onCancel(async () => {
    hotkeyCancelled = true;
    actions?.setGlobalHotkeyRecording(false);
    if (hotkeyStartPromise) {
      await hotkeyStartPromise;
    }
    if (hotkeyRecording) {
      hotkeyRecording = false;
      try {
        await hotkeyRecorder.stop({ chime: "none" });
      } catch {
        /* already stopped */
      }
    }
    await playCancelChime();
    await finishGlobalSession();
  });

  return () => {
    unsubStart();
    unsubStop();
    unsubCancel();
  };
}

export function initGlobalHotkeyController(): () => void {
  return createGlobalHotkeyController();
}
