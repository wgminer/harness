import { ExternalLink } from "lucide-react";
import type { GlobalRecordingStatus } from "../../shared/desktopAPI";
import { SettingsActions } from "./SettingsActions";
import { setCachedAccessibilityTrusted } from "./settingsSessionCache";

/** Permission buttons shown under the Fn shortcut switch until macOS grants access. */
export function FnShortcutControls({
  accessibilityTrusted,
  setAccessibilityTrusted,
  globalRecordingStatus,
  refreshGlobalRecordingStatus,
}: {
  accessibilityTrusted: boolean | null;
  setAccessibilityTrusted: (value: boolean | null) => void;
  globalRecordingStatus: GlobalRecordingStatus | null;
  refreshGlobalRecordingStatus: () => Promise<void>;
}) {
  // Avoid flashing action buttons while macOS permission checks are still in flight.
  if (accessibilityTrusted === null || globalRecordingStatus == null) {
    return null;
  }

  const needsAccessibility =
    accessibilityTrusted !== true ||
    globalRecordingStatus.monitorHealth === "accessibility_denied";
  const mic = globalRecordingStatus.microphonePermission;
  const needsMicrophone = mic !== "granted" && mic !== "unsupported";
  if (!needsAccessibility && !needsMicrophone) return null;

  return (
    <div className="settings-fn-controls">
      <SettingsActions>
        {needsAccessibility ? (
          <button
            type="button"
            className="btn"
            data-testid="settings-accessibility-prompt"
            onClick={() => {
              void window.harness.system.requestAccessibilityPrompt();
              void window.harness.system.openAccessibilitySettings();
              setTimeout(() => {
                void window.harness.system.macosAccessibilityTrusted().then((trusted) => {
                  setCachedAccessibilityTrusted(trusted);
                  setAccessibilityTrusted(trusted);
                });
              }, 1200);
            }}
          >
            Accessibility <ExternalLink size={14} aria-hidden />
          </button>
        ) : null}
        {needsMicrophone ? (
          <button
            type="button"
            className="btn"
            data-testid="settings-microphone-prompt"
            onClick={() => {
              void window.harness.recording.requestMicrophoneAccess().then((ok) => {
                void refreshGlobalRecordingStatus();
                if (!ok) {
                  void window.harness.system.openMicrophoneSettings();
                }
              });
            }}
          >
            Microphone <ExternalLink size={14} aria-hidden />
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          data-testid="settings-open-speech-recognition"
          onClick={() => {
            void window.harness.system.openSpeechRecognitionSettings();
          }}
        >
          Speech <ExternalLink size={14} aria-hidden />
        </button>
      </SettingsActions>
    </div>
  );
}
