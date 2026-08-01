import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { LLM_CONTEXT_EXPORT_PROMPT } from "../../shared/memoryImport";
import { sortedMemoryEntries } from "../../shared/memoryInjection";
import { Modal } from "../Modal";
import { SettingsActions } from "./SettingsActions";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsHint } from "./SettingsHint";
import { SystemPromptPreviewPanel } from "./SystemPromptPreviewPanel";
import { useMemorySettings } from "./useMemorySettings";

export type MemorySettingsController = ReturnType<typeof useMemorySettings>;

export { useMemorySettings };

const MEMORY_PAGE_SIZE = 10;

function collapseToSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function MemoryRow({
  memoryKey,
  value,
  onEdit,
  onDelete,
}: {
  memoryKey: string;
  value: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const displayValue = value === "" ? "—" : collapseToSingleLine(value);
  const tooltip = value ? `${memoryKey}\n${value}` : memoryKey;

  return (
    <div className="settings-memory-row settings-entry-row--actions-on-hover" title={tooltip}>
      <div className="settings-memory-row__key">{memoryKey}</div>
      <div className="settings-memory-row__value">{displayValue}</div>
      <div className="settings-entry-row__actions">
        <button
          type="button"
          className="btn btn-icon"
          data-action="edit"
          onClick={onEdit}
          aria-label={`Edit ${memoryKey}`}
          title="Edit"
        >
          <Pencil size={16} />
        </button>
        <button
          type="button"
          className="btn btn-icon"
          data-action="delete"
          onClick={onDelete}
          aria-label={`Remove ${memoryKey}`}
          title="Remove"
        >
          <Trash2 size={16} />
        </button>
      </div>
    </div>
  );
}

function MemoriesList({ memory }: { memory: MemorySettingsController }) {
  const entries = useMemo(() => sortedMemoryEntries(memory.userMemory), [memory.userMemory]);
  const total = entries.length;
  const pageCount = Math.max(1, Math.ceil(total / MEMORY_PAGE_SIZE) || 1);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setPage((current) => Math.min(current, Math.max(0, pageCount - 1)));
  }, [pageCount]);

  const start = page * MEMORY_PAGE_SIZE;
  const pageEntries = entries.slice(start, start + MEMORY_PAGE_SIZE);
  const rangeEnd = total === 0 ? 0 : Math.min(start + pageEntries.length, total);
  const showPager = total > MEMORY_PAGE_SIZE;

  return (
    <>
      {total === 0 ? (
        <SettingsHint flush>No memories yet.</SettingsHint>
      ) : (
        <div className="settings-memory-list" data-testid="settings-memory-list">
          {pageEntries.map(([k, v]) => (
            <MemoryRow
              key={k}
              memoryKey={k}
              value={v}
              onEdit={() => memory.openEditMemoryModal(k, v)}
              onDelete={() => void memory.deleteMemoryEntry(k)}
            />
          ))}
        </div>
      )}
      <div className="settings-memory-toolbar">
        <SettingsActions>
          <button
            type="button"
            className="btn"
            data-testid="settings-add-memory"
            onClick={memory.openAddMemoryModal}
          >
            Add Memory
          </button>
        </SettingsActions>
        {showPager ? (
          <div className="settings-memory-pager" role="navigation" aria-label="Memory pages">
            <button
              type="button"
              className="btn btn-icon"
              data-testid="settings-memory-prev"
              aria-label="Previous page"
              disabled={page <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft size={16} aria-hidden />
            </button>
            <span className="settings-memory-pager__status" data-testid="settings-memory-page-status">
              {start + 1}–{rangeEnd} of {total}
            </span>
            <button
              type="button"
              className="btn btn-icon"
              data-testid="settings-memory-next"
              aria-label="Next page"
              disabled={page >= pageCount - 1}
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            >
              <ChevronRight size={16} aria-hidden />
            </button>
          </div>
        ) : total > 0 ? (
          <span className="settings-memory-pager__status" data-testid="settings-memory-page-status">
            {total} {total === 1 ? "memory" : "memories"}
          </span>
        ) : null}
      </div>
    </>
  );
}

/** Memories list + system prompt + add/edit modal. Used inside Data. */
export function MemorySettingsSections({ memory }: { memory: MemorySettingsController }) {
  return (
    <>
      <SettingsGroup
        title="Memory"
        description="Synced with backup."
        collapsible
        defaultOpen={false}
      >
        <MemoriesList memory={memory} />
      </SettingsGroup>

      <SystemPromptPreviewPanel collapsible defaultOpen={false} />

      <Modal
        open={memory.memoryModalOpen}
        onClose={memory.closeMemoryModal}
        title={memory.editingMemoryKey ? "Edit memory" : "Add memory"}
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
            <span className="app-modal-field__label">Key</span>
            <p className="app-modal-field__hint">
              Id for this memory. Same key overwrites.
            </p>
            <input
              type="text"
              value={memory.newMemTitle}
              onChange={(e) => memory.setNewMemTitle(e.target.value)}
              className="app-modal-input"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="app-modal-field">
            <span className="app-modal-field__label">Value</span>
            <textarea
              value={memory.newMemDetail}
              onChange={(e) => memory.setNewMemDetail(e.target.value)}
              className="app-modal-input app-modal-input--multiline"
              rows={5}
              autoComplete="off"
            />
          </label>
        </div>
      </Modal>
    </>
  );
}

/** Memory import UI for the Data → Import → Memories subsection. */
export function MemoryImportSection({ memory }: { memory: MemorySettingsController }) {
  return (
    <div className="settings-memory-import">
      <div className="settings-memory-import__step">
        <div className="settings-memory-import__step-head">
          <span className="settings-memory-import__step-index" aria-hidden>
            1
          </span>
          <div className="settings-memory-import__step-copy">
            <span className="settings-memory-import__step-title">Export prompt</span>
          </div>
        </div>
        <SettingsActions>
          <button type="button" className="btn" onClick={() => void memory.copyExportPrompt()}>
            Copy Export Prompt
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => memory.setExportPromptOpen((open) => !open)}
            aria-expanded={memory.exportPromptOpen}
          >
            {memory.exportPromptOpen ? "Hide Prompt" : "Show Prompt"}
          </button>
        </SettingsActions>
        {memory.exportPromptOpen ? (
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
        ) : null}
      </div>

      <div className="settings-memory-import__step">
        <div className="settings-memory-import__step-head">
          <span className="settings-memory-import__step-index" aria-hidden>
            2
          </span>
          <div className="settings-memory-import__step-copy">
            <span className="settings-memory-import__step-title">Paste result</span>
          </div>
        </div>
        <label className="app-modal-field">
          <span className="app-modal-field__label">Pasted export</span>
          <textarea
            value={memory.llmImportDraft}
            onChange={(e) => memory.setLlmImportDraft(e.target.value)}
            className="app-modal-input app-modal-input--multiline settings-llm-import-export"
            rows={10}
            data-testid="settings-llm-import-export"
          />
        </label>
      </div>

      <div className="settings-memory-import__step">
        <div className="settings-memory-import__step-head">
          <span className="settings-memory-import__step-index" aria-hidden>
            3
          </span>
          <div className="settings-memory-import__step-copy">
            <span className="settings-memory-import__step-title">Import</span>
          </div>
        </div>
        <SettingsActions>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="settings-import-llm-context"
            onClick={() => void memory.runLlmContextImport()}
            disabled={memory.llmImportBusy || !memory.llmImportDraft.trim()}
          >
            {memory.llmImportBusy ? "Importing…" : "Import Memories"}
          </button>
        </SettingsActions>
        {memory.llmImportMessage ? (
          <SettingsHint flush>{memory.llmImportMessage}</SettingsHint>
        ) : null}
      </div>
    </div>
  );
}
