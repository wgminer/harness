import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceState } from "./chatHelpers";
import { MICROPHONE_PERMISSION_DENIED_MESSAGE } from "./recordingAudioUtils";
import { transcribeWav } from "./recordingPipeline";
import { playCancelChime } from "./recordingUtils";
import { useRecorder } from "./useRecorder";

const MAX_RECORDING_MS = 5 * 60 * 1000;

export type VoiceTranscriptResult = {
  cleanupSkipped?: "no_api_key";
  recordingPath?: string;
};

export interface UseVoiceCaptureOptions {
  /**
   * Called with local-mic transcripts (and optionally by callers for other
   * delivery paths). Return false to signal the transcript was not applied.
   */
  onTranscript: (
    text: string,
    result?: VoiceTranscriptResult,
  ) => void | boolean | Promise<void | boolean>;
  /**
   * When true, mirror focused Fn global recording into voice chrome
   * (timer / mic / Transcribing…) without starting a second local capture.
   */
  mirrorGlobalFnRecording?: boolean;
}

/**
 * Shared inline + Fn-mirrored voice capture used by the chat composer and
 * writing-surface toolbar.
 */
export function useVoiceCapture({
  onTranscript,
  mirrorGlobalFnRecording = false,
}: UseVoiceCaptureOptions) {
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);

  const recordingStartRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptionRequestIdRef = useRef<string | null>(null);
  const transcriptionCancelledRef = useRef(false);
  const mirroringGlobalRef = useRef(false);
  const onTranscriptRef = useRef(onTranscript);

  const recorder = useRecorder();

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  });

  useEffect(() => {
    if (!mirrorGlobalFnRecording) {
      if (mirroringGlobalRef.current) {
        mirroringGlobalRef.current = false;
        if (recordingTimerRef.current) {
          clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        setVoiceState("idle");
        setRecordingMs(0);
      }
      return;
    }

    const clearMirrorTimer = () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };

    const endMirror = () => {
      if (!mirroringGlobalRef.current) return;
      mirroringGlobalRef.current = false;
      clearMirrorTimer();
      setVoiceState("idle");
      setRecordingMs(0);
    };

    const unsubStarted = window.harness.recording.onGlobalRecordingStarted(({ focused }) => {
      if (!focused) return;
      mirroringGlobalRef.current = true;
      setVoiceError(null);
      setRecordingMs(0);
      setVoiceState("recording");
      recordingStartRef.current = Date.now();
      clearMirrorTimer();
      recordingTimerRef.current = setInterval(() => {
        setRecordingMs(Date.now() - recordingStartRef.current);
      }, 33);
    });

    const unsubStopped = window.harness.recording.onGlobalRecordingStopped(() => {
      if (!mirroringGlobalRef.current) return;
      clearMirrorTimer();
      setVoiceState("processing");
    });

    const unsubCancelled = window.harness.recording.onGlobalRecordingCancelled(() => {
      endMirror();
    });

    const unsubError = window.harness.recording.onGlobalRecordingError(({ message }) => {
      if (!mirroringGlobalRef.current) return;
      endMirror();
      setVoiceError(message);
    });

    const unsubReady = window.harness.recording.onGlobalTranscriptReady(() => {
      endMirror();
    });

    const unsubDelivered = window.harness.recording.onGlobalTranscriptDelivered(() => {
      endMirror();
    });

    return () => {
      unsubStarted();
      unsubStopped();
      unsubCancelled();
      unsubError();
      unsubReady();
      unsubDelivered();
    };
  }, [mirrorGlobalFnRecording]);

  const stopAndTranscribe = useCallback(async () => {
    if (mirroringGlobalRef.current) {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      setVoiceState("processing");
      await window.harness.recording.stopGlobalRecording().catch(() => {});
      return;
    }
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
        await onTranscriptRef.current(result.text, {
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
  }, [recorder]);

  const startRecording = useCallback(async () => {
    if (mirroringGlobalRef.current) return;
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
    if (mirroringGlobalRef.current) {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      mirroringGlobalRef.current = false;
      setVoiceState("idle");
      setVoiceError(null);
      setRecordingMs(0);
      await window.harness.recording.cancelGlobalSession().catch(() => {});
      return;
    }
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

  const resetVoiceCapture = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    transcriptionRequestIdRef.current = null;
    transcriptionCancelledRef.current = false;
    setVoiceState("idle");
    setVoiceError(null);
    setRecordingMs(0);
  }, []);

  return {
    voiceState,
    voiceError,
    setVoiceError,
    recordingMs,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
    resetVoiceCapture,
  };
}

export function formatVoiceTimer(recordingMs: number): string {
  return `${Math.floor(recordingMs / 60000)}:${String(Math.floor((recordingMs % 60000) / 1000)).padStart(2, "0")}.${Math.floor((recordingMs % 1000) / 100)}`;
}
