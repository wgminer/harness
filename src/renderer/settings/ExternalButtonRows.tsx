import { useCallback, useEffect, useState } from "react";
import type { ExternalButtonStatus } from "../../shared/desktopAPI";
import { SecretField } from "./SecretField";
import { SettingsField } from "./SettingsField";
import { SettingsPanelBlock, SettingsSwitchRow } from "./SettingsPanel";

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

/** Voice PE centre button over the ESPHome API, standing in for the Fn key. Panel rows. */
export function ExternalButtonRows() {
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
    <>
      <SettingsSwitchRow
        id="externalButtonToggle"
        testId="settings-external-button"
        label="Voice PE button"
        description="Hold the centre button of a Home Assistant Voice PE instead of Fn."
        checked={status.enabled}
        disabled={busy}
        onChange={(e) => void save({ enabled: e.target.checked, host })}
      />
      {status.enabled ? (
        <SettingsPanelBlock>
          <div className="settings-field-grid">
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
                onBlur={() => {
                  if (key.trim()) void save({ enabled: true, host, key: key.trim() });
                }}
                ariaLabel="Voice PE encryption key"
                placeholder={status.keyConfigured ? "Saved" : "api_key from the ESPHome config"}
              />
            </SettingsField>
          </div>
          {error ? (
            <p className="settings-inline-error">{error}</p>
          ) : (
            <p className="settings-row__desc">{statusLine(status)}</p>
          )}
        </SettingsPanelBlock>
      ) : null}
    </>
  );
}
