import { ExternalLink } from "lucide-react";
import { appDataFolderButtonLabel } from "../../shared/dataStorageLayout";
import { ClaudeImportModal } from "./ClaudeImportModal";
import { SettingsActions } from "./SettingsActions";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";
import { SettingsSubsection } from "./SettingsSubsection";
import { SettingsTabPanel } from "./SettingsTabPanel";
import {
  MemoryImportSection,
  MemorySettingsSections,
  useMemorySettings,
} from "./MemorySettingsTab";
import { useDataSettings } from "./useDataSettings";

export interface DataSettingsTabProps {
  platform: NodeJS.Platform;
  onImportComplete?: () => void;
}

export function DataSettingsTab({ platform, onImportComplete }: DataSettingsTabProps) {
  const data = useDataSettings({ onImportComplete });
  const memory = useMemorySettings();

  return (
    <>
      <SettingsTabPanel id="data">
        <MemorySettingsSections memory={memory} />

        <SettingsGroup title="Import">
          <SettingsSubsection title="Chat history">
            <SettingsActions>
              <button
                type="button"
                className="btn"
                onClick={data.runImport}
                disabled={data.importing}
              >
                {data.importing ? "Importing…" : "Import From ChatGPT"}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="settings-claude-import"
                onClick={() => void data.runClaudeImport()}
                disabled={data.claudeImporting || data.claudeConfirming}
              >
                {data.claudeImporting ? "Reading Export…" : "Import From Claude"}
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
          </SettingsSubsection>

          <SettingsSubsection
            title="Memories"
            description="Uses your OpenAI key."
          >
            <MemoryImportSection memory={memory} />
          </SettingsSubsection>
        </SettingsGroup>

        <SettingsGroup title="Storage">
          <SettingsActions>
            <button type="button" className="btn" onClick={() => window.harness.memory.openAppDataFolder()}>
              {appDataFolderButtonLabel(platform)} <ExternalLink size={14} aria-hidden />
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => window.harness.recording.openFolder()}
            >
              Show Recordings <ExternalLink size={14} aria-hidden />
            </button>
            {data.dataStatus?.legacyMemoryExists && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void data.runCleanupLegacyMemory()}
                disabled={data.cleanupLegacyBusy}
              >
                {data.cleanupLegacyBusy ? "Cleaning…" : "Clean Legacy Memory Folder"}
              </button>
            )}
          </SettingsActions>
          <SettingsHint flush>Backup syncs everything except recordings.</SettingsHint>
          {data.dataStatus?.legacyMemoryExists && data.cleanupLegacyMessage && (
            <SettingsHint flush>{data.cleanupLegacyMessage}</SettingsHint>
          )}
        </SettingsGroup>
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
