import { useEffect, useRef, useState } from "react";
import { JoyDivisionField } from "./JoyDivisionField";

interface HotkeyRecordingOverlayProps {
  active: boolean;
  error?: string | null;
}

function recordingFieldSize(): { width: number; height: number } {
  const short = Math.min(window.innerWidth, window.innerHeight);
  // ~half the short window edge, clamped so tiny/huge windows stay readable.
  const height = Math.round(Math.min(Math.max(short * 0.52, 340), 720));
  const width = Math.round(height * 0.9);
  return { width, height };
}

/**
 * Full-screen recording status. When active, shows a white Joy Division field
 * driven by `global-recording-level` (subscribed here so App is not re-rendered at meter rate).
 */
export function HotkeyRecordingOverlay({ active, error }: HotkeyRecordingOverlayProps) {
  const levelRef = useRef(0);
  const [fieldSize, setFieldSize] = useState(recordingFieldSize);

  useEffect(() => {
    if (!active) {
      levelRef.current = 0;
      return;
    }
    return window.harness.recording.onGlobalRecordingLevel((level) => {
      levelRef.current = level;
    });
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const sync = () => setFieldSize(recordingFieldSize());
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [active]);

  if (!active && !error) return null;

  return (
    <div
      className="hotkey-recording-overlay"
      data-testid="hotkey-recording-overlay"
      data-recording={active ? "true" : "false"}
      role="status"
      aria-live="polite"
      aria-label={error ?? (active ? "Recording" : "Recording status")}
    >
      {active ? (
        <JoyDivisionField
          active={active}
          levelRef={levelRef}
          width={fieldSize.width}
          height={fieldSize.height}
          className="hotkey-recording-overlay__field"
        />
      ) : null}
      {error ? (
        <div className="hotkey-recording-overlay__error" data-testid="hotkey-recording-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
