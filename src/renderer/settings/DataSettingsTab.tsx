import { useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { appDataFolderButtonLabel } from "../../shared/dataStorageLayout";
import { SyncQrModal } from "../SyncQrModal";
import { Tooltip } from "../Tooltip";
import { SecretField } from "./SecretField";
import { SettingsActions } from "./SettingsActions";
import { SettingsField } from "./SettingsField";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";
import { SettingsTabPanel } from "./SettingsTabPanel";
import { useDataSettings } from "./useDataSettings";

export interface DataSettingsTabProps {
  platform: NodeJS.Platform;
  apiKey: string;
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
  onSyncComplete?: () => void;
  onImportComplete?: () => void;
  onRegisterRefresh?: (refresh: () => Promise<void>) => void;
}

export function DataSettingsTab({
  platform,
  apiKey,
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
  onSyncComplete,
  onImportComplete,
  onRegisterRefresh,
}: DataSettingsTabProps) {
  const data = useDataSettings({ onSyncComplete, onImportComplete });

  useEffect(() => {
    onRegisterRefresh?.(data.refreshDataStatus);
  }, [data.refreshDataStatus, onRegisterRefresh]);

  return (
    <>
      <SettingsTabPanel id="data">
        <SettingsGroup
          title="Local data"
          description="Harness stores conversations, notes, and settings on this device. Backup syncs everything except local recordings."
        >
          <SettingsActions>
            <button type="button" className="btn" onClick={() => window.harness.memory.openAppDataFolder()}>
              {appDataFolderButtonLabel(platform)} <ExternalLink size={14} aria-hidden />
            </button>
            {data.dataStatus?.legacyMemoryExists && (
              <button
                type="button"
                className="btn"
                onClick={() => void data.runCleanupLegacyMemory()}
                disabled={data.cleanupLegacyBusy}
              >
                {data.cleanupLegacyBusy ? "Cleaning…" : "Clean Legacy Memory Folder"}
              </button>
            )}
          </SettingsActions>
          {data.dataStatus?.legacyMemoryExists && data.cleanupLegacyMessage && (
            <SettingsHint flush>{data.cleanupLegacyMessage}</SettingsHint>
          )}
        </SettingsGroup>

        <SettingsGroup
          title="Backup (R2)"
          description={
            <>
              Connect a Cloudflare R2 bucket. Harness stores <code>bundle.json.gz</code> and{" "}
              <code>manifest.json</code> under the prefix below. Enable object versioning in R2 for
              free backup history.
            </>
          }
        >
          <SettingsActions>
            <button type="button" className="btn btn-primary" onClick={() => data.setSyncQrOpen(true)}>
              Show sync QR
            </button>
          </SettingsActions>
          <SettingsHint>
            Pair an iPhone by scanning this QR. Manual R2 fields below remain for advanced setup.
          </SettingsHint>
          <SettingsField label="Account ID" htmlFor="settings-r2-account">
            <input
              id="settings-r2-account"
              type="text"
              value={r2AccountId}
              onChange={(e) => setR2AccountId(e.target.value)}
              placeholder="Cloudflare account ID"
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
              placeholder="harness-sync"
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
              placeholder="harness/"
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
              placeholder="Secret access key"
              ariaLabel="R2 secret access key"
            />
          </SettingsField>
          {(data.dataStatus?.sync.lastError || data.r2TestError) && (
            <p className="settings-import-status__errors">
              {data.dataStatus?.sync.lastError ?? data.r2TestError}
            </p>
          )}
          <SettingsActions>
            <button
              type="button"
              className="btn"
              onClick={() => void data.testR2Connection()}
              disabled={data.syncTestBusy}
            >
              {data.syncTestBusy ? "Testing…" : "Test Connection"}
            </button>
            <div className="settings-sync-control">
              <Tooltip label={data.syncTooltip}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void data.runSyncNow()}
                  disabled={data.syncBusy || !data.dataStatus?.sync.configured}
                >
                  {data.syncBusy ? "Syncing…" : "Sync Now"}
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

        <SettingsGroup title="Import chat history">
          <details className="settings-import-details">
            <summary>Import chat history (optional)</summary>
            <p className="settings-group__lead settings-import-details__lead">
              Bring conversations from ChatGPT or Claude exports into Harness. This is separate
              from importing facts on the Memory tab.
            </p>
            <div className="settings-import-details__section">
              <h4 className="settings-import-details__heading">ChatGPT</h4>
              <p className="settings-group__hint">Choose the folder from an unzipped ChatGPT export.</p>
              <SettingsActions>
                <button type="button" className="btn" onClick={data.runImport} disabled={data.importing}>
                  {data.importing ? "Importing…" : "Import From ChatGPT"}
                </button>
              </SettingsActions>
              {data.importStatus != null && (
                <div className="settings-import-status" role="status">
                  {data.importStatus.imported > 0 && (
                    <p className="settings-import-status__ok">
                      Imported {data.importStatus.imported} conversation
                      {data.importStatus.imported !== 1 ? "s" : ""}.
                    </p>
                  )}
                  {data.importStatus.errors.length > 0 && (
                    <div className="settings-import-status__errors">
                      <p>Errors:</p>
                      <ul>
                        {data.importStatus.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="settings-import-details__section">
              <h4 className="settings-import-details__heading">Claude</h4>
              <p className="settings-group__hint">
                Choose the folder from Claude.ai&apos;s &ldquo;Export data&rdquo; archive (contains{" "}
                <code>conversations.json</code>). Re-imports skip threads already added.
              </p>
              <SettingsActions>
                <button
                  type="button"
                  className="btn"
                  data-testid="settings-claude-import"
                  onClick={data.runClaudeImport}
                  disabled={data.claudeImporting}
                >
                  {data.claudeImporting ? "Importing…" : "Import From Claude"}
                </button>
              </SettingsActions>
              {data.claudeImportStatus != null && (
                <div className="settings-import-status" role="status">
                  {data.claudeImportStatus.imported > 0 && (
                    <p className="settings-import-status__ok">
                      Imported {data.claudeImportStatus.imported} conversation
                      {data.claudeImportStatus.imported !== 1 ? "s" : ""}.
                    </p>
                  )}
                  {data.claudeImportStatus.errors.length > 0 && (
                    <div className="settings-import-status__errors">
                      <p>Errors:</p>
                      <ul>
                        {data.claudeImportStatus.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>
        </SettingsGroup>
      </SettingsTabPanel>

      <SyncQrModal
        open={data.syncQrOpen}
        onClose={() => data.setSyncQrOpen(false)}
        accountId={r2AccountId}
        bucket={r2Bucket}
        prefix={r2Prefix}
        accessKeyId={r2AccessKeyId}
        secretAccessKey={r2SecretAccessKey}
        openaiApiKey={apiKey}
      />
    </>
  );
}
