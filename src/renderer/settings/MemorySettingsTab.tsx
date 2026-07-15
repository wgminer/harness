import { LLM_CONTEXT_EXPORT_PROMPT } from "../../shared/memoryImport";
import { Modal } from "../Modal";
import { SettingsActions } from "./SettingsActions";
import { SettingsEntryRow } from "./SettingsEntryRow";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";
import { SettingsTabPanel } from "./SettingsTabPanel";
import { SystemPromptPreviewPanel } from "./SystemPromptPreviewPanel";
import { useMemorySettings } from "./useMemorySettings";

export function MemorySettingsTab() {
  const memory = useMemorySettings();

  return (
    <>
      <SettingsTabPanel id="memory">
        <SystemPromptPreviewPanel />

        <SettingsGroup
          title="Your facts"
          description="Stable facts stored locally and synced with your backup. Pick a short label and a one-line value; the same label updates the existing entry."
        >
          <div className="settings-entry-list">
            {Object.entries(memory.userMemory).map(([k, v]) => (
              <SettingsEntryRow
                key={k}
                title={k}
                detail={v}
                onEdit={() => memory.openEditMemoryModal(k, v)}
                onDelete={() => void memory.deleteMemoryEntry(k)}
                editAriaLabel={`Edit ${k}`}
                deleteAriaLabel={`Remove ${k}`}
              />
            ))}
          </div>
          <SettingsActions>
            <button
              type="button"
              className="btn"
              data-testid="settings-add-memory"
              onClick={memory.openAddMemoryModal}
            >
              Add Entry
            </button>
          </SettingsActions>
        </SettingsGroup>

        <SettingsGroup
          title="Import from another assistant"
          description={
            <>
              Run the export prompt in ChatGPT, Claude, or another assistant, paste the result
              below, then import. Harness uses your OpenAI API key to distill entries into your
              facts above (same merge rules as learn from past chats).
            </>
          }
        >
          <SettingsActions>
            <button
              type="button"
              className="btn"
              onClick={() => memory.setExportPromptOpen((open) => !open)}
              aria-expanded={memory.exportPromptOpen}
            >
              {memory.exportPromptOpen ? "Hide Export Prompt" : "Show Export Prompt"}
            </button>
            <button type="button" className="btn" onClick={() => void memory.copyExportPrompt()}>
              Copy Export Prompt
            </button>
          </SettingsActions>
          {memory.exportPromptOpen && (
            <label className="app-modal-field">
              <span className="app-modal-field__label">Export prompt</span>
              <textarea
                readOnly
                value={LLM_CONTEXT_EXPORT_PROMPT}
                className="app-modal-input app-modal-input--multiline settings-llm-import-prompt"
                rows={12}
                aria-label="Export prompt for other assistants"
              />
            </label>
          )}
          <label className="app-modal-field">
            <span className="app-modal-field__label">Pasted export</span>
            <textarea
              placeholder="Paste the structured export from the other assistant…"
              value={memory.llmImportDraft}
              onChange={(e) => memory.setLlmImportDraft(e.target.value)}
              className="app-modal-input app-modal-input--multiline settings-llm-import-export"
              rows={14}
              data-testid="settings-llm-import-export"
            />
          </label>
          <SettingsActions>
            <button
              type="button"
              className="btn btn-primary"
              data-testid="settings-import-llm-context"
              onClick={() => void memory.runLlmContextImport()}
              disabled={memory.llmImportBusy || !memory.llmImportDraft.trim()}
            >
              {memory.llmImportBusy ? "Importing…" : "Import Facts"}
            </button>
          </SettingsActions>
          {memory.llmImportMessage && <SettingsHint flush>{memory.llmImportMessage}</SettingsHint>}
        </SettingsGroup>
      </SettingsTabPanel>

      <Modal
        open={memory.memoryModalOpen}
        onClose={memory.closeMemoryModal}
        title={memory.editingMemoryKey ? "Edit entry" : "Add entry"}
        data-testid="settings-memory-modal"
        footer={
          <>
            <button type="button" className="btn" onClick={memory.closeMemoryModal}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void memory.saveMemory()}
              disabled={!memory.newMemTitle.trim()}
            >
              {memory.editingMemoryKey ? "Update" : "Save"}
            </button>
          </>
        }
      >
        <div className="app-modal-stack">
          <label className="app-modal-field">
            <span className="app-modal-field__label">Label</span>
            <input
              type="text"
              placeholder="e.g. timezone"
              value={memory.newMemTitle}
              onChange={(e) => memory.setNewMemTitle(e.target.value)}
              className="app-modal-input"
              autoComplete="off"
            />
          </label>
          <label className="app-modal-field">
            <span className="app-modal-field__label">Detail</span>
            <textarea
              placeholder="What to remember"
              value={memory.newMemDetail}
              onChange={(e) => memory.setNewMemDetail(e.target.value)}
              className="app-modal-input app-modal-input--multiline"
              rows={4}
              autoComplete="off"
            />
          </label>
        </div>
      </Modal>
    </>
  );
}
