import { ExternalLink } from "lucide-react";
import type { GlobalRecordingStatus } from "../../shared/desktopAPI";
import { SettingsPill, SettingsRow } from "./SettingsPanel";
import { setCachedAccessibilityTrusted } from "./settingsSessionCache";

const ACCESSIBILITY_RECHECK_MS = 1200;

/** macOS permissions the Fn shortcut depends on, each with its state and a way to grant it. */
export function VoicePermissionRows({
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
  // Avoid flashing the wrong state while macOS permission checks are still in flight.
  if (accessibilityTrusted === null || globalRecordingStatus == null) {
    return null;
  }

  const accessibilityOk =
    accessibilityTrusted === true && globalRecordingStatus.monitorHealth !== "accessibility_denied";
  const mic = globalRecordingStatus.microphonePermission;
  const microphoneOk = mic === "granted" || mic === "unsupported";

  const openAccessibility = () => {
    void window.harness.system.requestAccessibilityPrompt();
    void window.harness.system.openAccessibilitySettings();
    setTimeout(() => {
      void window.harness.system.macosAccessibilityTrusted().then((trusted) => {
        setCachedAccessibilityTrusted(trusted);
        setAccessibilityTrusted(trusted);
      });
    }, ACCESSIBILITY_RECHECK_MS);
  };

  const allowMicrophone = () => {
    void window.harness.recording.requestMicrophoneAccess().then((ok) => {
      void refreshGlobalRecordingStatus();
      if (!ok) void window.harness.system.openMicrophoneSettings();
    });
  };

  return (
    <>
      <SettingsRow label="Microphone" description="Records what you say.">
        {microphoneOk ? (
          <SettingsPill tone="ok">Allowed</SettingsPill>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            data-testid="settings-microphone-prompt"
            onClick={allowMicrophone}
          >
            Allow
          </button>
        )}
      </SettingsRow>
      <SettingsRow label="Accessibility" description="Lets Harness hear Fn while you're in other apps.">
        {accessibilityOk ? (
          <SettingsPill tone="ok">Allowed</SettingsPill>
        ) : (
          <button
            type="button"
            className="btn btn-sm"
            data-testid="settings-accessibility-prompt"
            onClick={openAccessibility}
          >
            Open Accessibility <ExternalLink size={14} aria-hidden />
          </button>
        )}
      </SettingsRow>
      <SettingsRow label="Speech recognition" description="Needed for Apple Speech.">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          data-testid="settings-open-speech-recognition"
          onClick={() => void window.harness.system.openSpeechRecognitionSettings()}
        >
          Open settings <ExternalLink size={14} aria-hidden />
        </button>
      </SettingsRow>
    </>
  );
}
