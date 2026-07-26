import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { JoyDivisionField } from "./JoyDivisionField";
import type { GlobalHotkeyOverlayPhase } from "./globalHotkeyController";

interface HotkeyRecordingOverlayProps {
  phase: GlobalHotkeyOverlayPhase;
  error?: string | null;
  recordingPath?: string | null;
  onRetry?: () => void;
  onShowInFinder?: () => void;
  onDismiss?: () => void;
}

function recordingFieldSize(): { width: number; height: number } {
  const short = Math.min(window.innerWidth, window.innerHeight);
  // ~half the short window edge, clamped so tiny/huge windows stay readable.
  const height = Math.round(Math.min(Math.max(short * 0.52, 340), 720));
  const width = Math.round(height * 0.9);
  return { width, height };
}

/**
 * Full-screen Fn dictation chrome for unfocused captures.
 * Recording: Joy Division field. Transcribing: spinner. Failed: actions.
 */
export function HotkeyRecordingOverlay({
  phase,
  error,
  recordingPath,
  onRetry,
  onShowInFinder,
  onDismiss,
}: HotkeyRecordingOverlayProps) {
  const levelRef = useRef(0);
  const [fieldSize, setFieldSize] = useState(recordingFieldSize);
  const recording = phase === "recording";
  const interactive = phase === "failed";

  useEffect(() => {
    if (!recording) {
      levelRef.current = 0;
      return;
    }
    return window.harness.recording.onGlobalRecordingLevel((level) => {
      levelRef.current = level;
    });
  }, [recording]);

  useEffect(() => {
    if (!recording) return;
    const sync = () => setFieldSize(recordingFieldSize());
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [recording]);

  useEffect(() => {
    if (phase !== "failed" && phase !== "transcribing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (phase === "failed") {
        onDismiss?.();
      } else if (phase === "transcribing") {
        void window.harness.recording.cancelGlobalTranscription();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, onDismiss]);

  if (phase === "idle") return null;

  return (
    <div
      className="hotkey-recording-overlay"
      data-testid="hotkey-recording-overlay"
      data-recording={recording ? "true" : "false"}
      data-phase={phase}
      data-interactive={interactive ? "true" : "false"}
      role="status"
      aria-live="polite"
      aria-label={
        error ??
        (phase === "recording"
          ? "Recording"
          : phase === "transcribing"
            ? "Transcribing"
            : "Recording status")
      }
    >
      {phase === "recording" ? (
        <JoyDivisionField
          active={recording}
          levelRef={levelRef}
          width={fieldSize.width}
          height={fieldSize.height}
          className="hotkey-recording-overlay__field"
        />
      ) : null}

      {phase === "transcribing" ? (
        <div className="hotkey-recording-overlay__transcribing" data-testid="hotkey-recording-transcribing">
          <Loader2 size={28} className="hotkey-recording-overlay__spinner" aria-hidden />
          <span>Transcribing…</span>
        </div>
      ) : null}

      {phase === "failed" ? (
        <div className="hotkey-recording-overlay__failed" data-testid="hotkey-recording-failed">
          <p className="hotkey-recording-overlay__error-text">{error ?? "Something went wrong."}</p>
          <div className="hotkey-recording-overlay__actions">
            <button
              type="button"
              className="btn btn-primary"
              data-testid="hotkey-recording-retry"
              onClick={() => onRetry?.()}
              disabled={!recordingPath}
            >
              Retry
            </button>
            {recordingPath ? (
              <button
                type="button"
                className="btn"
                data-testid="hotkey-recording-show-in-finder"
                onClick={() => onShowInFinder?.()}
              >
                Show in Finder
              </button>
            ) : null}
            <button
              type="button"
              className="btn"
              data-testid="hotkey-recording-dismiss"
              onClick={() => onDismiss?.()}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
