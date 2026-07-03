interface HotkeyRecordingOverlayProps {
  active: boolean;
}

export function HotkeyRecordingOverlay({ active }: HotkeyRecordingOverlayProps) {
  if (!active) return null;

  return (
    <div
      className="hotkey-recording-overlay"
      data-testid="hotkey-recording-overlay"
      role="status"
      aria-live="polite"
      aria-label="Recording"
    >
      <div className="hotkey-recording-overlay__badge">
        <span className="hotkey-recording-overlay__dot" aria-hidden />
        Recording
      </div>
    </div>
  );
}
