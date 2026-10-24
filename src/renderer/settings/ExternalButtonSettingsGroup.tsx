import { useCallback, useEffect, useState } from "react";
import type { ExternalButtonStatus } from "../../shared/desktopAPI";
import { SecretField } from "./SecretField";
import { SettingsActions } from "./SettingsActions";
import { SettingsField } from "./SettingsField";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";
import { SettingsSwitch } from "./SettingsSwitch";

function statusLine(status: ExternalButtonStatus): string {
  switch (status.state) {
    case "connected":
      return `Connected to ${status.host}. Hold the centre button to dictate.`;
    case "searching":
      return `Looking for ${status.host}. Make sure it is powered on and on this network.`;
    case "error":
      return status.message ?? "Could not connect.";
    default:
      return "";
  }
}

/** Voice PE centre button over the ESPHome API, standing in for the Fn key. */
export function ExternalButtonSettingsGroup() {
  const [status, setStatus] = useState<ExternalButtonStatus | null>(null);
  const [host, setHost] = useState("");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.harness.externalButton
      .getStatus()
      .then((next) => {
        setStatus(next);
        setHost(next.host);
      })
      .catch(() => {});
    return window.harness.externalButton.onStatus(setStatus);
  }, []);

  const save = useCallback(
    async (input: { enabled: boolean; host: string; key?: string }) => {
      setBusy(true);
      setError(null);
      try {
        setStatus(await window.harness.externalButton.configure(input));
        if (input.key) setKey("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  if (!status) return null;

  const hostChanged = host.trim() !== status.host;

  return (
    <SettingsGroup title="External button">
      <SettingsSwitch
        id="externalButtonToggle"
        testId="settings-external-button"
        label="Voice PE button"
        checked={status.enabled}
        disabled={busy}
        onChange={(e) => void save({ enabled: e.target.checked, host })}
      />
      {status.enabled ? (
        <>
          <SettingsField label="Host" htmlFor="settings-external-button-host">
            <input
              id="settings-external-button-host"
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              onBlur={() => {
                if (hostChanged) void save({ enabled: true, host });
              }}
              placeholder="voicepe.local"
              autoComplete="off"
              spellCheck={false}
            />
          </SettingsField>
          <SettingsField label="Encryption key" htmlFor="settings-external-button-key">
            <SecretField
              id="settings-external-button-key"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              ariaLabel="Voice PE encryption key"
              placeholder={status.keyConfigured ? "Saved" : "api_key from the ESPHome config"}
            />
          </SettingsField>
          {key.trim() ? (
            <SettingsActions>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void save({ enabled: true, host, key: key.trim() })}
              >
                Save key
              </button>
            </SettingsActions>
          ) : null}
          {error ? (
            <p className="settings-import-status__errors">{error}</p>
          ) : (
            <SettingsHint>{statusLine(status)}</SettingsHint>
          )}
        </>
      ) : null}
    </SettingsGroup>
  );
}
