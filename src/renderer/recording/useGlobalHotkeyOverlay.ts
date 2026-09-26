import { useCallback, useEffect, useRef, useState } from "react";
import type { GlobalHotkeyOverlayPhase } from "./globalHotkeyController";

/** State for the global Fn-hotkey recording overlay and its error chip. */
export function useGlobalHotkeyOverlay() {
  const [overlaySession, setOverlaySession] = useState(false);
  const [phase, setPhase] = useState<GlobalHotkeyOverlayPhase>("idle");
  const [error, setErrorState] = useState<string | null>(null);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const overlaySessionRef = useRef(false);
  useEffect(() => {
    overlaySessionRef.current = overlaySession;
  }, [overlaySession]);

  const setError = useCallback((message: string | null, path?: string | null) => {
    setErrorState(message);
    if (path !== undefined) {
      setRecordingPath(path);
    }
  }, []);

  useEffect(() => {
    // Auto-clear focused-path error chips only (overlay failed stays until dismiss).
    if (!error || phase === "failed") return;
    const timer = window.setTimeout(() => setError(null, null), 8000);
    return () => window.clearTimeout(timer);
  }, [error, phase, setError]);

  const retry = useCallback(() => {
    if (!recordingPath) return;
    setPhase("transcribing");
    setError(null, recordingPath);
    void window.harness.recording.retryGlobalTranscription(recordingPath);
  }, [recordingPath, setError]);

  const showInFinder = useCallback(() => {
    if (!recordingPath) return;
    void window.harness.recording.showInFolder(recordingPath);
  }, [recordingPath]);

  const dismiss = useCallback(() => {
    setOverlaySession(false);
    setPhase("idle");
    setError(null, null);
  }, [setError]);

  return {
    phase,
    error,
    recordingPath,
    setOverlaySession,
    setPhase,
    setError,
    getOverlaySession: useCallback(() => overlaySessionRef.current, []),
    retry,
    showInFinder,
    dismiss,
  };
}
