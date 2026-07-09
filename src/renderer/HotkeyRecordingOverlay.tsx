interface HotkeyRecordingOverlayProps {
  active: boolean;
  error?: string | null;
}

export function HotkeyRecordingOverlay({ active, error }: HotkeyRecordingOverlayProps) {
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
        <div className="hotkey-recording-overlay__badge">
          <span className="hotkey-recording-overlay__dot" aria-hidden />
          Recording
        </div>
      ) : null}
      {error ? (
        <div className="hotkey-recording-overlay__error" data-testid="hotkey-recording-error">
          {error}
        </div>
      ) : null}
    </div>
  );
}
