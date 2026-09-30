import { useCallback, useEffect, useRef, useState } from "react";
import type { GlobalHotkeyOverlayPhase } from "./globalHotkeyController";

/** State for the global Fn-hotkey recording overlay and its error chip. */
export function useGlobalHotkeyOverlay() {
  const [overlaySession, setOverlaySession] = useState(false);
  const [phase, setPhase] = useState<GlobalHotkeyOverlayPhase>("idle");
  const [error, setErrorState] = useState<string | null>(null);
  const [recordingPath, setRecordingPath] = useState<string | null>(null);
  const [needsAccessibility, setNeedsAccessibility] = useState(false);
  const overlaySessionRef = useRef(false);
  useEffect(() => {
    overlaySessionRef.current = overlaySession;
  }, [overlaySession]);

  const setError = useCallback((message: string | null, path?: string | null, accessibility = false) => {
    setErrorState(message);
    setNeedsAccessibility(message !== null && accessibility);
    if (path !== undefined) {
      setRecordingPath(path);
    }
  }, []);

  useEffect(() => {
    // Auto-clear focused-path error chips only (overlay failed stays until dismiss;
    // retryable chips stay until Retry / Dismiss).
    if (!error || phase === "failed" || recordingPath) return;
    const timer = window.setTimeout(() => setError(null, null), 8000);
    return () => window.clearTimeout(timer);
  }, [error, phase, recordingPath, setError]);

  const retry = useCallback(() => {
    if (!recordingPath) return;
    // No overlay session means the take started focused — land it in the composer again.
    const focused = !overlaySessionRef.current;
    setPhase("transcribing");
    setError(null, recordingPath);
    window.harness.recording
      .retryGlobalTranscription(recordingPath, { focused })
      .catch((err: unknown) => {
        setPhase(focused ? "idle" : "failed");
        setError(err instanceof Error ? err.message : String(err), recordingPath);
      });
  }, [recordingPath, setError]);

  const showInFinder = useCallback(() => {
    if (!recordingPath) return;
    void window.harness.recording.showInFolder(recordingPath);
  }, [recordingPath]);

  const openAccessibilitySettings = useCallback(() => {
    void window.harness.system.openAccessibilitySettings();
  }, []);

  const dismiss = useCallback(() => {
    setOverlaySession(false);
    setPhase("idle");
    setError(null, null);
  }, [setError]);

  return {
    phase,
    error,
    recordingPath,
    needsAccessibility,
    setOverlaySession,
    setPhase,
    setError,
    getOverlaySession: useCallback(() => overlaySessionRef.current, []),
    retry,
    showInFinder,
    openAccessibilitySettings,
    dismiss,
  };
}
