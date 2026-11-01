import { useState, type ReactNode } from "react";
import { Cloud, Laptop, Loader2, Smartphone } from "lucide-react";
import { formatRelativeTime } from "../../shared/usageFormat";
import { Tooltip } from "../ui/Tooltip";
import { SecretField } from "./SecretField";
import { SettingsField } from "./SettingsField";
import { SettingsPane, SettingsPanelBlock, SettingsPill, SettingsRow } from "./SettingsPanel";
import type { useDataSettings } from "./useDataSettings";

/** Anchor for the sync error banner's "Review" button. */
export const SETTINGS_SYNC_SECTION_ID = "settings-sync";

export interface SyncPaneProps {
  data: ReturnType<typeof useDataSettings>;
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
}

function SyncNode({ icon, name, sub, hub }: { icon: ReactNode; name: string; sub: string; hub?: boolean }) {
  return (
    <div className={`settings-sync-node${hub ? " settings-sync-node--hub" : ""}`}>
      <span className="settings-sync-node__box">{icon}</span>
      <span className="settings-sync-node__name">{name}</span>
      <span className="settings-sync-node__sub">{sub}</span>
    </div>
  );
}

export function SyncPane({
  data,
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
}: SyncPaneProps) {
  const [editing, setEditing] = useState(false);
  const sync = data.dataStatus?.sync;
  const configured = sync?.configured === true;
  const syncError = sync?.lastError ?? data.r2TestError;
  const fieldsOpen = editing || (sync != null && !configured) || !!syncError;

  const r2Description = !sync
    ? ""
    : !configured
      ? "Fill in your bucket below."
      : (data.syncInlineStatus ??
        (sync.lastSuccessAt ? `Last synced ${formatRelativeTime(sync.lastSuccessAt)}` : "Not synced yet"));

  return (
    <SettingsPane
      id={SETTINGS_SYNC_SECTION_ID}
      title="Sync"
      description="Back up and sync across devices with your own Cloudflare R2 bucket. Recordings stay on this Mac."
    >
      <div className="settings-sync-path" aria-hidden>
        <SyncNode icon={<Laptop size={20} />} name="This Mac" sub="Everything" />
        <span className={`settings-sync-link${configured ? "" : " settings-sync-link--off"}`} />
        <SyncNode icon={<Cloud size={20} />} name={r2Bucket.trim() || "Your bucket"} sub="Cloudflare R2" hub />
        <span className={`settings-sync-link${configured ? "" : " settings-sync-link--off"}`} />
        <SyncNode icon={<Smartphone size={20} />} name="iPhone" sub="Paired by QR code" />
      </div>

      <SettingsRow label="Cloudflare R2" description={r2Description} testId="settings-sync-r2">
        {configured && !syncError ? <SettingsPill tone="ok">Connected</SettingsPill> : null}
        {configured ? (
          <button type="button" className="btn btn-sm" aria-expanded={fieldsOpen} onClick={() => setEditing((v) => !v)}>
            {editing ? "Done" : "Edit"}
          </button>
        ) : null}
        <Tooltip label={data.syncTooltip}>
          <button
            type="button"
            className="btn btn-sm btn-primary settings-sync-now"
            onClick={() => void data.runSyncNow()}
            disabled={data.syncBusy || !configured}
            aria-busy={data.syncBusy}
          >
            {data.syncBusy ? (
              <>
                <Loader2 size={14} className="voice-spinner" aria-hidden />
                Syncing…
              </>
            ) : (
              "Sync now"
            )}
          </button>
        </Tooltip>
      </SettingsRow>

      {fieldsOpen ? (
        <SettingsPanelBlock>
          <div className="settings-field-grid">
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
            <SettingsField label="Prefix" htmlFor="settings-r2-prefix">
              <input
                id="settings-r2-prefix"
                type="text"
                value={r2Prefix}
                onChange={(e) => setR2Prefix(e.target.value)}
                placeholder="Optional"
                autoComplete="off"
                spellCheck={false}
              />
            </SettingsField>
          </div>
          {syncError ? (
            <p className="settings-inline-error" role="alert">
              {syncError}
            </p>
          ) : null}
          <div>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void data.testR2Connection()}
              disabled={data.syncTestBusy}
            >
              {data.syncTestBusy ? "Testing…" : "Test connection"}
            </button>
          </div>
        </SettingsPanelBlock>
      ) : null}

      <SettingsRow
        label="Pair iPhone"
        description="Scan a QR code in Harness on your iPhone to copy these settings."
        testId="settings-sync-pair"
      >
        <button type="button" className="btn btn-sm" onClick={onShowSyncQr} disabled={!configured}>
          Show QR code
        </button>
      </SettingsRow>
    </SettingsPane>
  );
}
