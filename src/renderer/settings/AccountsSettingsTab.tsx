import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { GmailSettingsSection } from "./GmailSettingsSection";
import { SecretField } from "./SecretField";
import { SettingsActions } from "./SettingsActions";
import { SettingsField } from "./SettingsField";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsSubsection } from "./SettingsSubsection";
import { SettingsTabPanel } from "./SettingsTabPanel";
import { useDataSettings } from "./useDataSettings";

/** Anchor for the sync error banner's "Review" button. */
export const SETTINGS_SYNC_SECTION_ID = "settings-sync";

export interface AccountsSettingsTabProps {
  apiKey: string;
  setApiKey: (value: string) => void;
  tavilyApiKey: string;
  setTavilyApiKey: (value: string) => void;
  r2AccountId: string;
  setR2AccountId: (value: string) => void;
  r2Bucket: string;
  setR2Bucket: (value: string) => void;
  r2Prefix: string;
  setR2Prefix: (value: string) => void;
  r2AccessKeyId: string;
  setR2AccessKeyId: (value: string) => void;
  r2SecretAccessKey: string;
  setR2SecretAccessKey: (value: string) => void;
  persistSettings: () => Promise<boolean>;
  onShowSyncQr: () => void;
  onSyncComplete?: () => void;
  onRegisterRefresh?: (refresh: () => Promise<void>) => void;
}

export function AccountsSettingsTab({
  apiKey,
  setApiKey,
  tavilyApiKey,
  setTavilyApiKey,
  r2AccountId,
  setR2AccountId,
  r2Bucket,
  setR2Bucket,
  r2Prefix,
  setR2Prefix,
  r2AccessKeyId,
  setR2AccessKeyId,
  r2SecretAccessKey,
  setR2SecretAccessKey,
  persistSettings,
  onShowSyncQr,
  onSyncComplete,
  onRegisterRefresh,
}: AccountsSettingsTabProps) {
  const data = useDataSettings({ onSyncComplete });
  const syncError = data.dataStatus?.sync.lastError ?? data.r2TestError;

  useEffect(() => {
    onRegisterRefresh?.(data.refreshDataStatus);
  }, [data.refreshDataStatus, onRegisterRefresh]);

  return (
    <SettingsTabPanel id="accounts">
      <SettingsGroup
        id={SETTINGS_SYNC_SECTION_ID}
        title="Sync"
        description="Back up and sync across devices with your own Cloudflare R2 bucket. Recordings stay on this Mac."
      >
        <SettingsField label="Account ID" htmlFor="settings-r2-account">
          <input
            id="settings-r2-account"
            type="text"
            value={r2AccountId}
            onChange={(e) => setR2AccountId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </SettingsField>
        <SettingsField label="Bucket" htmlFor="settings-r2-bucket">
          <input
            id="settings-r2-bucket"
            type="text"
            value={r2Bucket}
            onChange={(e) => setR2Bucket(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </SettingsField>
        <SettingsField label="Prefix" htmlFor="settings-r2-prefix">
          <input
            id="settings-r2-prefix"
            type="text"
            value={r2Prefix}
            onChange={(e) => setR2Prefix(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </SettingsField>
        <SettingsField label="Access key ID" htmlFor="settings-r2-access-key-id">
          <input
            id="settings-r2-access-key-id"
            type="text"
            value={r2AccessKeyId}
            onChange={(e) => setR2AccessKeyId(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </SettingsField>
        <SettingsField label="Secret access key" htmlFor="settings-r2-secret">
          <SecretField
            id="settings-r2-secret"
            value={r2SecretAccessKey}
            onChange={(e) => setR2SecretAccessKey(e.target.value)}
            onBlur={() => void persistSettings()}
            ariaLabel="R2 secret access key"
          />
        </SettingsField>
        {syncError ? (
          <p className="settings-import-status__errors" role="alert">
            {syncError}
          </p>
        ) : null}
        <SettingsActions>
          <button
            type="button"
            className="btn"
            onClick={() => void data.testR2Connection()}
            disabled={data.syncTestBusy}
          >
            {data.syncTestBusy ? "Testing…" : "Test"}
          </button>
          <button type="button" className="btn" onClick={onShowSyncQr}>
            Show Sync QR
          </button>
          <div className="settings-sync-control">
            <Tooltip label={data.syncTooltip}>
              <button
                type="button"
                className="btn btn-primary settings-sync-now"
                onClick={() => void data.runSyncNow()}
                disabled={data.syncBusy || !data.dataStatus?.sync.configured}
                aria-busy={data.syncBusy}
              >
                {data.syncBusy ? (
                  <>
                    <Loader2 size={14} className="voice-spinner" aria-hidden />
                    Syncing…
                  </>
                ) : (
                  "Sync"
                )}
              </button>
            </Tooltip>
            {data.syncInlineStatus ? (
              <span className="settings-sync-status" role="status">
                {data.syncInlineStatus}
              </span>
            ) : null}
          </div>
        </SettingsActions>
      </SettingsGroup>

      <SettingsGroup title="API keys">
        <SettingsSubsection
          title="OpenAI"
          description="Chat, polish, transcript cleanup, and memory import."
        >
          <SettingsField label="API key" htmlFor="settings-api-key">
            <SecretField
              id="settings-api-key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              onBlur={() => void persistSettings()}
              ariaLabel="OpenAI API key"
            />
          </SettingsField>
        </SettingsSubsection>

        <SettingsSubsection
          title="Tavily"
          description={
            <>
              Optional, for web search. Get a key at{" "}
              <a href="https://tavily.com" target="_blank" rel="noreferrer noopener">
                tavily.com
              </a>
              .
            </>
          }
        >
          <SettingsField label="API key" htmlFor="settings-tavily-key">
            <SecretField
              id="settings-tavily-key"
              testId="settings-tavily-key"
              value={tavilyApiKey}
              onChange={(e) => setTavilyApiKey(e.target.value)}
              onBlur={() => void persistSettings()}
              ariaLabel="Tavily API key"
            />
          </SettingsField>
        </SettingsSubsection>
      </SettingsGroup>

      <SettingsGroup title="Connections">
        <GmailSettingsSection />
      </SettingsGroup>
    </SettingsTabPanel>
  );
}
