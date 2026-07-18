import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useRecorder } from "./useRecorder";
import { transcribeWav } from "./recordingPipeline";
import { playCancelChime } from "./recordingUtils";
import { audioFileToWav } from "./audioFileToWav";
import { MICROPHONE_PERMISSION_DENIED_MESSAGE } from "./recordingAudioUtils";
import type { VoiceState } from "./chatHelpers";
import { transcriptCleanupSkippedMessage } from "../shared/setupState";
import type { Settings } from "../shared/types";

const MAX_RECORDING_MS = 5 * 60 * 1000;

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
    async (
      text: string,
      result?: { cleanupSkipped?: "no_api_key"; recordingPath?: string },
    ): Promise<boolean> => {
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
        setVoiceError(transcriptCleanupSkippedMessage());
      }
      return true;
    },
    [pendingHotkeyDraftOnly]
  );

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
      const requestId = crypto.randomUUID();
      transcriptionRequestIdRef.current = requestId;
      const result = await transcribeWav(wav);
      if (transcriptionCancelledRef.current || transcriptionRequestIdRef.current !== requestId) {
        return;
      }
      if ("error" in result) {
        setVoiceError(result.error);
      } else {
        await applyTranscriptToComposer(result.text, {
          cleanupSkipped: result.cleanupSkipped === "no_api_key" ? "no_api_key" : undefined,
          recordingPath: result.path,
        });
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
      setVoiceError(err instanceof Error ? err.message : MICROPHONE_PERMISSION_DENIED_MESSAGE);
    }
  }, [recorder, stopAndTranscribe]);

  const cancelRecording = useCallback(async () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (voiceState === "processing" && transcriptionRequestIdRef.current) {
      transcriptionCancelledRef.current = true;
      void window.harness.recording.cancelTranscription(transcriptionRequestIdRef.current).catch(() => {});
      transcriptionRequestIdRef.current = null;
    }
    try {
      if (voiceState === "recording") {
        await recorder.stop({ chime: "none" });
      }
    } catch {
      // already stopped
    }
    await playCancelChime();
    setVoiceState("idle");
    setVoiceError(null);
    setRecordingMs(0);
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
