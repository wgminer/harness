import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { audioFileToWav } from "./audioFileToWav";
import { transcriptCleanupSkippedMessage } from "../shared/setupState";
import type { Settings } from "../shared/types";
import { useVoiceCapture, type VoiceTranscriptResult } from "./useVoiceCapture";

export interface UseChatComposerOptions {
  onSubmit: (
    text: string,
    opts?: { fromDictation?: boolean; recordingPath?: string },
  ) => void | boolean | Promise<void | boolean>;
  pendingHotkeyText?: string | null;
  pendingHotkeyDraftOnly?: boolean;
  onPendingHotkeyTextConsumed?: () => void;
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

export function useChatComposer({
  onSubmit,
  pendingHotkeyText,
  pendingHotkeyDraftOnly,
  onPendingHotkeyTextConsumed,
  focusComposerNonce,
  composerRef,
  submitDisabled = false,
  allowHotkeyWithoutConversation = false,
  hasConversation = true,
  mirrorGlobalFnRecording = false,
}: UseChatComposerOptions) {
  const [input, setInput] = useState("");
  const [attachedAudioFile, setAttachedAudioFile] = useState<File | null>(null);
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
    if (!text && !attached) return;

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

    const messageText = text && transcript ? `${text}\n\n${transcript}` : text || transcript;
    if (!messageText) return;

    const previousInput = input;
    const previousAttached = attachedAudioFile;
    setInput("");
    setAttachedAudioFile(null);
    const sent = await submitMessage(messageText);
    if (!sent) {
      setInput(previousInput);
      setAttachedAudioFile(previousAttached);
    }
  }, [attachedAudioFile, attachmentTranscribing, input, submitDisabled, submitMessage, submitting]);

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

  const resetComposerInput = useCallback(() => {
    setInput("");
    resetVoiceCapture();
    setAttachedAudioFile(null);
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
