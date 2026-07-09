export type TranscribeResult =
  | { text: string; cleanupSkipped?: "no_api_key" }
  | { error: string };

export type DeliverFocusedResult = {
  kind: "focused";
  text: string;
};

export type DeliverUnfocusedCallbacks = {
  onConversationCreated: (conversation: {
    id: string;
    title: string;
    createdAt: number;
    sessionKind: "dictation";
    hasMessages: true;
  }) => void;
  onConversationSelected: (id: string) => void;
  refreshConversations: () => void | Promise<void>;
};

export async function transcribeWav(wav: ArrayBuffer): Promise<TranscribeResult> {
  window.harness.recording.saveWav(wav).catch(() => {});
  const result = await window.harness.recording.transcribe(wav);
  if ("error" in result) {
    return { error: result.error };
  }
  return { text: result.text, cleanupSkipped: result.cleanupSkipped };
}

export async function deliverTranscriptUnfocused(
  text: string,
  callbacks: DeliverUnfocusedCallbacks,
): Promise<void> {
  await window.harness.recording.pasteText(text);
  const newId = await window.harness.memory.createConversation();
  await window.harness.memory.appendMessage(newId, "user", text, { timestamp: Date.now() });
  const voiceTitle = await window.harness.memory.markVoiceDictationSession(newId);
  callbacks.onConversationCreated({
    id: newId,
    title: voiceTitle,
    createdAt: Date.now(),
    sessionKind: "dictation",
    hasMessages: true,
  });
  callbacks.onConversationSelected(newId);
  await callbacks.refreshConversations();
}

export function deliverTranscriptFocused(text: string): DeliverFocusedResult {
  return { kind: "focused", text };
}

export async function finishGlobalSession(): Promise<void> {
  await window.harness.recording.done();
}
