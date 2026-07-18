import { Modal } from "../Modal";

export type ClaudeImportPreviewConversation = {
  claudeId: string;
  title: string | null;
  createdAt: number;
  messageCount: number;
  alreadyImported: boolean;
};

export type ClaudeImportPreview = {
  folderPath: string;
  found: number;
  alreadyImported: number;
  conversations: ClaudeImportPreviewConversation[];
  errors: string[];
};

interface ClaudeImportModalProps {
  open: boolean;
  preview: ClaudeImportPreview | null;
  selectedIds: Set<string>;
  onToggle: (claudeId: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onClose: () => void;
  onConfirm: () => void;
  confirming: boolean;
}

function formatCreatedAt(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

export function ClaudeImportModal({
  open,
  preview,
  selectedIds,
  onToggle,
  onSelectAll,
  onSelectNone,
  onClose,
  onConfirm,
  confirming,
}: ClaudeImportModalProps) {
  const selectedCount = selectedIds.size;
  const total = preview?.conversations.length ?? 0;
  const newCount = preview?.conversations.filter((c) => !c.alreadyImported).length ?? 0;
  const selectedExisting =
    preview?.conversations.filter((c) => c.alreadyImported && selectedIds.has(c.claudeId)).length ??
    0;

  const confirmLabel = (() => {
    if (confirming) return "Importing…";
    if (selectedExisting > 0 && selectedCount === selectedExisting) {
      return `Refresh ${selectedCount} conversation${selectedCount !== 1 ? "s" : ""}`;
    }
    if (selectedExisting > 0) {
      return `Import / refresh ${selectedCount}`;
    }
    return `Import ${selectedCount} conversation${selectedCount !== 1 ? "s" : ""}`;
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import from Claude"
      closeDisabled={confirming}
      variant="scrollable"
      size="lg"
      data-testid="claude-import-modal"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={confirming}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={confirming || selectedCount === 0}
            data-testid="claude-import-confirm"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {preview == null ? null : (
        <div className="claude-import-review">
          <p className="claude-import-review__summary">
            Found {preview.found} conversation{preview.found !== 1 ? "s" : ""}
            {newCount > 0 ? ` · ${newCount} new` : ""}
            {preview.alreadyImported > 0
              ? ` · ${preview.alreadyImported} already imported (re-select to refresh)`
              : ""}
            .
          </p>
          {preview.errors.length > 0 && (
            <div className="settings-import-status__errors">
              <p>Warnings:</p>
              <ul>
                {preview.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
          {total === 0 ? (
            <p className="claude-import-review__empty">
              Nothing to import from this export.
            </p>
          ) : (
            <>
              <div className="claude-import-review__toolbar">
                <button type="button" className="btn btn-sm" onClick={onSelectAll} disabled={confirming}>
                  Select all
                </button>
                <button type="button" className="btn btn-sm" onClick={onSelectNone} disabled={confirming}>
                  Select none
                </button>
                <span className="claude-import-review__count">
                  {selectedCount} of {total} selected
                </span>
              </div>
              <ul className="claude-import-review__list" role="list">
                {preview.conversations.map((c) => {
                  const checked = selectedIds.has(c.claudeId);
                  const label = c.title?.trim() || "Untitled conversation";
                  return (
                    <li key={c.claudeId}>
                      <label className="claude-import-review__row app-modal-check">
                        <input
                          type="checkbox"
                          className="app-modal-check__input"
                          checked={checked}
                          disabled={confirming}
                          onChange={() => onToggle(c.claudeId)}
                        />
                        <span className="claude-import-review__row-body">
                          <span className="claude-import-review__title">{label}</span>
                          <span className="claude-import-review__meta">
                            {formatCreatedAt(c.createdAt)}
                            {" · "}
                            {c.messageCount} message{c.messageCount !== 1 ? "s" : ""}
                            {c.alreadyImported ? " · already imported" : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
