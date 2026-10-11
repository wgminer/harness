import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceState } from "../chat/chatHelpers";
import {
  cancelTake,
  landingKey,
  registerTakeHandler,
  startMicTake,
  stopTake,
  useDictationTake,
  type TakeLanding,
  type TakeTranscriptResult,
} from "./dictationTake";

export type VoiceTranscriptResult = TakeTranscriptResult;

export interface UseVoiceCaptureOptions {
  /**
   * Called with transcripts of takes that land on this surface. Return false to
   * signal the transcript was not applied.
   */
  onTranscript: (
    text: string,
    result?: VoiceTranscriptResult,
  ) => void | boolean | Promise<void | boolean>;
  /**
   * Where this surface's takes land. A take pinned here, in-app or focused Fn,
   * drives this surface's voice chrome (timer / mic / Transcribing…).
   */
  landing: TakeLanding;
}

/**
 * Voice chrome for one surface (chat composer, writing-surface toolbar). The take
 * itself lives in `dictationTake`, so it survives this surface unmounting.
 */
export function useVoiceCapture({ onTranscript, landing }: UseVoiceCaptureOptions) {
  const take = useDictationTake();
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);

  const key = landingKey(landing);
  const landingRef = useRef(landing);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    landingRef.current = landing;
    onTranscriptRef.current = onTranscript;
  });

  useEffect(
    () =>
      registerTakeHandler(key, {
        deliver: (text, result) => onTranscriptRef.current(text, result),
        onError: setVoiceError,
      }),
    [key],
  );

  const mine = take?.landing != null && landingKey(take.landing) === key ? take : null;
  const voiceState: VoiceState = mine?.phase ?? "idle";
  const recordingSince = mine?.phase === "recording" ? mine.startedAt : null;

  useEffect(() => {
    if (recordingSince == null) {
      setRecordingMs(0);
      return;
    }
    const tick = () => setRecordingMs(Date.now() - recordingSince);
    tick();
    const timer = setInterval(tick, 33);
    return () => clearInterval(timer);
  }, [recordingSince]);

  const startRecording = useCallback(async () => {
    setVoiceError(null);
    await startMicTake(landingRef.current);
  }, []);

  const stopAndTranscribe = useCallback(async () => {
    setVoiceError(null);
    await stopTake();
  }, []);

  const cancelRecording = useCallback(async () => {
    setVoiceError(null);
    await cancelTake();
  }, []);

  /** Clear this surface's voice error; the take, if any, keeps running. */
  const resetVoiceCapture = useCallback(() => {
    setVoiceError(null);
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
