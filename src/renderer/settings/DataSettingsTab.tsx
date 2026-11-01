import { useEffect } from "react";
import { ExternalLink } from "lucide-react";
import { appDataFolderButtonLabel } from "../../shared/dataStorageLayout";
import { ClaudeImportModal } from "./ClaudeImportModal";
import {
  MemoryImportSection,
  MemorySettingsSections,
  useMemorySettings,
} from "./MemorySettingsTab";
import { SettingsDisclosure, SettingsPane, SettingsPanelBlock, SettingsRow } from "./SettingsPanel";
import { SettingsTabPanel } from "./SettingsTabPanel";
import { SyncPane, type SyncPaneProps } from "./SyncPane";
import { useDataSettings } from "./useDataSettings";

export interface DataSettingsTabProps extends Omit<SyncPaneProps, "data"> {
  platform: NodeJS.Platform;
  onImportComplete?: () => void;
  onSyncComplete?: () => void;
  onRegisterRefresh?: (refresh: () => Promise<void>) => void;
}

export function DataSettingsTab({
  platform,
  onImportComplete,
  onSyncComplete,
  onRegisterRefresh,
  ...syncProps
}: DataSettingsTabProps) {
  const data = useDataSettings({ onImportComplete, onSyncComplete });
  const memory = useMemorySettings();

  useEffect(() => {
    onRegisterRefresh?.(data.refreshDataStatus);
  }, [data.refreshDataStatus, onRegisterRefresh]);

  const hasImportStatus = data.importStatus != null || data.claudeImportStatus != null;

  return (
    <>
      <SettingsTabPanel id="data">
        <SyncPane data={data} {...syncProps} />

        <MemorySettingsSections memory={memory} />

        <SettingsPane title="Import">
          <SettingsRow label="ChatGPT" description="Conversations from a ChatGPT data export.">
            <button
              type="button"
              className="btn btn-sm"
              onClick={data.runImport}
              disabled={data.importing}
            >
              {data.importing ? "Importing…" : "Choose export"}
            </button>
          </SettingsRow>
          <SettingsRow label="Claude" description="Conversations from a Claude data export. Pick which ones first.">
            <button
              type="button"
              className="btn btn-sm"
              data-testid="settings-claude-import"
              onClick={() => void data.runClaudeImport()}
              disabled={data.claudeImporting || data.claudeConfirming}
            >
              {data.claudeImporting ? "Reading export…" : "Choose export"}
            </button>
          </SettingsRow>
          {hasImportStatus ? (
            <SettingsPanelBlock>
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
                      <ul>
                        {data.importStatus.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {data.claudeImportStatus != null && (
                <div className="settings-import-status" role="status">
                  {(data.claudeImportStatus.imported > 0 || data.claudeImportStatus.updated > 0) && (
                    <p className="settings-import-status__ok">
                      {[
                        data.claudeImportStatus.imported > 0
                          ? `Imported ${data.claudeImportStatus.imported} conversation${
                              data.claudeImportStatus.imported !== 1 ? "s" : ""
                            }`
                          : null,
                        data.claudeImportStatus.updated > 0
                          ? `refreshed ${data.claudeImportStatus.updated}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      .
                    </p>
                  )}
                  {data.claudeImportStatus.imported === 0 &&
                    data.claudeImportStatus.updated === 0 &&
                    data.claudeImportStatus.errors.length === 0 && (
                      <p className="settings-import-status__ok">No conversations imported.</p>
                    )}
                  {data.claudeImportStatus.errors.length > 0 && (
                    <div className="settings-import-status__errors">
                      <ul>
                        {data.claudeImportStatus.errors.map((err, i) => (
                          <li key={i}>{err}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </SettingsPanelBlock>
          ) : null}
          <SettingsDisclosure
            label="Memories from another assistant"
            description="Copy a prompt, run it there, paste the result back. Uses your OpenAI key."
          >
            <MemoryImportSection memory={memory} />
          </SettingsDisclosure>
        </SettingsPane>

        <SettingsPane title="Storage">
          <SettingsRow label="App data" description="Conversations, notes, memory and settings. Sync backs all of it up.">
            <button type="button" className="btn btn-sm" onClick={() => window.harness.memory.openAppDataFolder()}>
              {appDataFolderButtonLabel(platform)} <ExternalLink size={14} aria-hidden />
            </button>
          </SettingsRow>
          <SettingsRow label="Recordings" description="Dictation audio. Stays on this Mac.">
            <button type="button" className="btn btn-sm" onClick={() => window.harness.recording.openFolder()}>
              Show folder <ExternalLink size={14} aria-hidden />
            </button>
          </SettingsRow>
          {data.dataStatus?.legacyMemoryExists ? (
            <SettingsRow
              label="Legacy memory folder"
              description={data.cleanupLegacyMessage ?? "Left over from an older version of Harness."}
            >
              <button
                type="button"
                className="btn btn-sm btn-danger"
                onClick={() => void data.runCleanupLegacyMemory()}
                disabled={data.cleanupLegacyBusy}
              >
                {data.cleanupLegacyBusy ? "Cleaning…" : "Clean up"}
              </button>
            </SettingsRow>
          ) : null}
        </SettingsPane>
      </SettingsTabPanel>

      <ClaudeImportModal
        open={data.claudePreview != null}
        preview={data.claudePreview}
        selectedIds={data.claudeSelectedIds}
        onToggle={data.toggleClaudeSelected}
        onSelectAll={data.selectAllClaude}
        onSelectNone={data.selectNoneClaude}
        onClose={data.closeClaudePreview}
        onConfirm={() => void data.confirmClaudeImport()}
        confirming={data.claudeConfirming}
      />
    </>
  );
}
