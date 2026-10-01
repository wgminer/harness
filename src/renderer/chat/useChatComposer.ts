import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { audioFileToWav } from "../recording/audioFileToWav";
import { transcriptCleanupSkippedMessage } from "../../shared/setupState";
import type { Settings } from "../../shared/types";
import { useVoiceCapture, type VoiceTranscriptResult } from "../recording/useVoiceCapture";
import { composeMessageWithPastes, type PastedTextBlock } from "./pastedText";

export interface UseChatComposerOptions {
  onSubmit: (
    text: string,
    opts?: { fromDictation?: boolean; recordingPath?: string },
  ) => void | boolean | Promise<void | boolean>;
  pendingHotkeyText?: string | null;
  pendingHotkeyDraftOnly?: boolean;
  onPendingHotkeyTextConsumed?: () => void;
  /** Text to place in the composer without sending (e.g. a note link from Discuss). */
  composerDraft?: ComposerDraft | null;
  onComposerDraftConsumed?: () => void;
  focusComposerNonce?: number;
  composerRef?: RefObject<HTMLDivElement | null>;
  /** When true, blocks send (e.g. model turn in progress). */
  submitDisabled?: boolean;
  /** Allow hotkey injection when no conversation is open (compose splash). */
  allowHotkeyWithoutConversation?: boolean;
  hasConversation?: boolean;
  /**
   * When true, mirror focused Fn global recording into composer voice chrome
   * (timer / mic / Transcribing…) without starting a second local capture.
   */
  mirrorGlobalFnRecording?: boolean;
}

export interface ComposerDraft {
  text: string;
  nonce: number;
}

export function useChatComposer({
  onSubmit,
  pendingHotkeyText,
  pendingHotkeyDraftOnly,
  onPendingHotkeyTextConsumed,
  composerDraft,
  onComposerDraftConsumed,
  focusComposerNonce,
  composerRef,
  submitDisabled = false,
  allowHotkeyWithoutConversation = false,
  hasConversation = true,
  mirrorGlobalFnRecording = false,
}: UseChatComposerOptions) {
  const [input, setInput] = useState("");
  const [attachedAudioFile, setAttachedAudioFile] = useState<File | null>(null);
  const [pastedBlocks, setPastedBlocks] = useState<PastedTextBlock[]>([]);
  const [attachmentTranscribing, setAttachmentTranscribing] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const onSubmitRef = useRef(onSubmit);
  const setVoiceErrorRef = useRef<(message: string | null) => void>(() => {});
  const applyTranscriptRef = useRef<
    (text: string, result?: VoiceTranscriptResult) => Promise<boolean>
  >(async () => false);

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  });

  useEffect(() => {
    if (focusComposerNonce == null || focusComposerNonce < 1) return;
    composerRef?.current?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
    inputRef.current?.focus();
  }, [focusComposerNonce, composerRef]);

  const submitMessage = useCallback(
    async (
      text: string,
      opts?: { fromDictation?: boolean; recordingPath?: string },
    ): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed || submitting || submitDisabled) return false;
      setSubmitting(true);
      try {
        const result = await onSubmitRef.current(trimmed, opts);
        return result !== false;
      } catch {
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [submitDisabled, submitting],
  );

  const send = useCallback(async () => {
    if (attachmentTranscribing || submitting || submitDisabled) return;

    const text = input.trim();
    const attached = attachedAudioFile;
    const pastes = pastedBlocks;
    if (!text && !attached && pastes.length === 0) return;

    setAttachmentError(null);
    let transcript = "";
    if (attached) {
      setAttachmentTranscribing(true);
      try {
        const wav = await audioFileToWav(attached);
        const result = await window.harness.recording.transcribe(wav);
        if ("error" in result) {
          setAttachmentError(result.error);
          return;
        }
        transcript = result.text.trim();
        if (!transcript) {
          setAttachmentError("Unable to transcribe attached audio.");
          return;
        }
      } catch (err) {
        setAttachmentError(err instanceof Error ? err.message : "Unable to read attached audio.");
        return;
      } finally {
        setAttachmentTranscribing(false);
      }
    }

    const typed = text && transcript ? `${text}\n\n${transcript}` : text || transcript;
    const messageText = composeMessageWithPastes(typed, pastes);
    if (!messageText) return;

    const previousInput = input;
    const previousAttached = attachedAudioFile;
    setInput("");
    setAttachedAudioFile(null);
    setPastedBlocks([]);
    const sent = await submitMessage(messageText);
    if (!sent) {
      setInput(previousInput);
      setAttachedAudioFile(previousAttached);
      setPastedBlocks(pastes);
    }
  }, [
    attachedAudioFile,
    attachmentTranscribing,
    input,
    pastedBlocks,
    submitDisabled,
    submitMessage,
    submitting,
  ]);

  const addPastedBlock = useCallback((text: string, name?: string) => {
    const id = `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setPastedBlocks((prev) => [...prev, name ? { id, text, name } : { id, text }]);
  }, []);

  const removePastedBlock = useCallback((id: string) => {
    setPastedBlocks((prev) => prev.filter((b) => b.id !== id));
  }, []);

  /** Moves a pasted block back into the draft as plain text. */
  const inlinePastedBlock = useCallback(
    (id: string) => {
      const block = pastedBlocks.find((b) => b.id === id);
      if (!block) return;
      setPastedBlocks((prev) => prev.filter((b) => b.id !== id));
      setInput((cur) => (cur.trim() ? `${cur.replace(/\s+$/, "")}\n\n${block.text}` : block.text));
    },
    [pastedBlocks],
  );

  const submitMessageRef = useRef(submitMessage);
  useEffect(() => {
    submitMessageRef.current = submitMessage;
  });

  const applyTranscriptToComposer = useCallback(
    async (text: string, result?: VoiceTranscriptResult): Promise<boolean> => {
      const trimmed = text.trim();
      if (!trimmed) return false;
      const settings = (await window.harness.settings.get()) as Settings;
      const credentialStatus = await window.harness.credentials.getStatus();
      const autoSend = settings.recording?.autoSend ?? true;
      const canChat = credentialStatus.hasOpenAIApiKey;
      if (autoSend && canChat && !pendingHotkeyDraftOnly) {
        return submitMessageRef.current(trimmed, {
          fromDictation: true,
          recordingPath: result?.recordingPath,
        });
      }
      setInput((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
      if (result?.cleanupSkipped === "no_api_key") {
        setVoiceErrorRef.current(transcriptCleanupSkippedMessage());
      }
      return true;
    },
    [pendingHotkeyDraftOnly],
  );

  useEffect(() => {
    applyTranscriptRef.current = applyTranscriptToComposer;
  });

  const {
    voiceState,
    voiceError,
    setVoiceError,
    recordingMs,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
    resetVoiceCapture,
  } = useVoiceCapture({
    onTranscript: (text, result) => applyTranscriptRef.current(text, result),
    mirrorGlobalFnRecording,
  });

  useEffect(() => {
    setVoiceErrorRef.current = setVoiceError;
  });

  useEffect(() => {
    if (!pendingHotkeyText) return;
    const hotkeyAllowed = hasConversation || allowHotkeyWithoutConversation;
    if (!hotkeyAllowed) return;
    void applyTranscriptToComposer(pendingHotkeyText).then((applied) => {
      if (applied) onPendingHotkeyTextConsumed?.();
    });
  }, [
    allowHotkeyWithoutConversation,
    applyTranscriptToComposer,
    hasConversation,
    pendingHotkeyText,
    onPendingHotkeyTextConsumed,
  ]);

  useEffect(() => {
    if (!composerDraft?.text) return;
    const text = composerDraft.text;
    setInput((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")}\n\n${text}` : text));
    onComposerDraftConsumed?.();
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [composerDraft, onComposerDraftConsumed]);

  const resetComposerInput = useCallback(() => {
    setInput("");
    resetVoiceCapture();
    setAttachedAudioFile(null);
    setPastedBlocks([]);
    setAttachmentTranscribing(false);
    setAttachmentError(null);
  }, [resetVoiceCapture]);

  return {
    input,
    setInput,
    inputRef,
    voiceState,
    voiceError,
    setVoiceError,
    recordingMs,
    attachedAudioFile,
    setAttachedAudioFile,
    pastedBlocks,
    addPastedBlock,
    removePastedBlock,
    inlinePastedBlock,
    attachmentTranscribing,
    attachmentError,
    setAttachmentError,
    send,
    submitMessage,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
    resetComposerInput,
    composerBusy: submitting || attachmentTranscribing,
  };
}
