import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { GmailStatus } from "../../shared/desktopAPI";
import { SecretField } from "./SecretField";
import { SettingsActions } from "./SettingsActions";
import { SettingsField } from "./SettingsField";
import { SettingsSubsection } from "./SettingsSubsection";

/** Gmail connection: your own Google OAuth desktop client, then browser consent. */
export function GmailSettingsSection() {
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.harness.gmail.getStatus().then(setStatus).catch(() => {});
  }, []);

  const run = useCallback(async (action: () => Promise<GmailStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const connect = () =>
    run(async () => {
      if (clientId.trim()) {
        await window.harness.gmail.setClient(clientId.trim(), clientSecret.trim());
        setClientId("");
        setClientSecret("");
      }
      return window.harness.gmail.connect();
    });

  const connected = status?.connected === true;
  const canConnect = !!status?.clientConfigured || clientId.trim().length > 0;

  return (
    <SettingsSubsection
      title="Gmail"
      description={
        connected ? (
          <>Connected{status?.email ? ` as ${status.email}` : ""}. Sending, drafting, and label changes ask first.</>
        ) : (
          <>
            Uses your own OAuth client: in Google Cloud Console, enable the Gmail API and create a{" "}
            <a
              href="https://console.cloud.google.com/apis/credentials"
              target="_blank"
              rel="noreferrer noopener"
            >
              Desktop app client
            </a>
            , with yourself as a test user.
          </>
        )
      }
    >
      {!connected && (
        <>
          <SettingsField label="Client ID" htmlFor="settings-google-client-id">
            <input
              id="settings-google-client-id"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={status?.clientConfigured ? "Saved" : ""}
              autoComplete="off"
              spellCheck={false}
            />
          </SettingsField>
          <SettingsField label="Client secret" htmlFor="settings-google-client-secret">
            <SecretField
              id="settings-google-client-secret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              ariaLabel="Google client secret"
            />
          </SettingsField>
        </>
      )}
      {error && <p className="settings-import-status__errors">{error}</p>}
      <SettingsActions>
        {connected ? (
          <button
            type="button"
            className="btn"
            onClick={() => void run(() => window.harness.gmail.disconnect())}
            disabled={busy}
          >
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void connect()}
            disabled={busy || !canConnect}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <Loader2 size={14} className="voice-spinner" aria-hidden />
                Waiting for Google…
              </>
            ) : (
              "Connect Gmail"
            )}
          </button>
        )}
      </SettingsActions>
    </SettingsSubsection>
  );
}
