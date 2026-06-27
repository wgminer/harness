import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useRecorder } from "./useRecorder";
import { playCancelChime } from "./recordingUtils";
import { audioFileToWav } from "./audioFileToWav";
import type { VoiceState } from "./chatHelpers";
import {
  hasOpenAIApiKey,
  openAIRequiredMessage,
  transcriptCleanupSkippedMessage,
} from "../shared/setupState";
import type { Settings } from "../shared/types";

const MAX_RECORDING_MS = 5 * 60 * 1000;

export interface UseChatComposerOptions {
  onSubmit: (text: string, opts?: { fromDictation?: boolean }) => void | Promise<void>;
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
}: UseChatComposerOptions) {
  const [input, setInput] = useState("");
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
  const [attachedAudioFile, setAttachedAudioFile] = useState<File | null>(null);
  const [attachmentTranscribing, setAttachmentTranscribing] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recordingStartRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptionRequestIdRef = useRef<string | null>(null);
  const transcriptionCancelledRef = useRef(false);
  const onSubmitRef = useRef(onSubmit);

  const recorder = useRecorder();

  useEffect(() => {
    onSubmitRef.current = onSubmit;
  });

  useEffect(() => {
    if (focusComposerNonce == null || focusComposerNonce < 1) return;
    composerRef?.current?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
    inputRef.current?.focus();
  }, [focusComposerNonce, composerRef]);

  const submitMessage = useCallback(
    async (text: string, opts?: { fromDictation?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed || submitting || submitDisabled) return;
      setSubmitting(true);
      try {
        await onSubmitRef.current(trimmed, opts);
      } finally {
        setSubmitting(false);
      }
    },
    [submitDisabled, submitting]
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
        const result = await window.electron.recording.transcribe(wav);
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

    setInput("");
    setAttachedAudioFile(null);
    await submitMessage(messageText);
  }, [attachedAudioFile, attachmentTranscribing, input, submitDisabled, submitMessage, submitting]);

  const submitMessageRef = useRef(submitMessage);
  useEffect(() => {
    submitMessageRef.current = submitMessage;
  });

  const applyTranscriptToComposer = useCallback(
    async (text: string, result?: { cleanupSkipped?: "no_api_key" }) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const settings = (await window.electron.settings.get()) as Settings;
      const autoSend = settings.recording?.autoSend ?? true;
      const canChat = hasOpenAIApiKey(settings);
      if (autoSend && canChat && !pendingHotkeyDraftOnly) {
        await submitMessageRef.current(trimmed, { fromDictation: true });
      } else {
        setInput((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
        if (autoSend && !canChat) {
          setVoiceError(openAIRequiredMessage());
        } else if (result?.cleanupSkipped === "no_api_key") {
          setVoiceError(transcriptCleanupSkippedMessage());
        }
      }
    },
    [pendingHotkeyDraftOnly]
  );

  useEffect(() => {
    if (!pendingHotkeyText) return;
    const hotkeyAllowed = hasConversation || allowHotkeyWithoutConversation;
    if (!hotkeyAllowed) return;
    void applyTranscriptToComposer(pendingHotkeyText).finally(() => {
      onPendingHotkeyTextConsumed?.();
    });
  }, [
    allowHotkeyWithoutConversation,
    applyTranscriptToComposer,
    hasConversation,
    pendingHotkeyText,
    onPendingHotkeyTextConsumed,
  ]);

  const stopAndTranscribe = useCallback(async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setVoiceState("processing");
    setVoiceError(null);
    transcriptionCancelledRef.current = false;
    try {
      const wav = await recorder.stop();
      window.electron.recording.saveWav(wav).catch(() => {});
      const requestId = crypto.randomUUID();
      transcriptionRequestIdRef.current = requestId;
      const result = await window.electron.recording.transcribe(wav, { requestId });
      if (transcriptionCancelledRef.current || transcriptionRequestIdRef.current !== requestId) {
        return;
      }
      if ("error" in result) {
        setVoiceError(result.error);
      } else {
        await applyTranscriptToComposer(result.text, result);
      }
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Recording failed.");
    } finally {
      transcriptionRequestIdRef.current = null;
      setVoiceState("idle");
    }
  }, [applyTranscriptToComposer, recorder]);

  const startRecording = useCallback(async () => {
    setVoiceError(null);
    setRecordingMs(0);
    try {
      await recorder.start();
      setVoiceState("recording");
      transcriptionCancelledRef.current = false;
      recordingStartRef.current = Date.now();
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - recordingStartRef.current;
        setRecordingMs(elapsed);
        if (elapsed >= MAX_RECORDING_MS) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          void stopAndTranscribe();
        }
      }, 33);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Microphone access denied.");
    }
  }, [recorder, stopAndTranscribe]);

  const cancelRecording = useCallback(async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (voiceState === "processing" && transcriptionRequestIdRef.current) {
      transcriptionCancelledRef.current = true;
      void window.electron.recording.cancelTranscription(transcriptionRequestIdRef.current).catch(() => {});
      transcriptionRequestIdRef.current = null;
    }
    try {
      if (voiceState === "recording") {
        await recorder.stop();
      }
    } catch {
      // already stopped
    }
    setVoiceState("idle");
    setVoiceError(null);
    setRecordingMs(0);
    playCancelChime();
  }, [recorder, voiceState]);

  const resetComposerInput = useCallback(() => {
    setInput("");
    setVoiceError(null);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    transcriptionRequestIdRef.current = null;
    transcriptionCancelledRef.current = false;
    setVoiceState("idle");
    setAttachedAudioFile(null);
    setAttachmentTranscribing(false);
    setAttachmentError(null);
    setRecordingMs(0);
  }, []);

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
