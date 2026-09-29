interface NoteConflictBarProps {
  onReload: () => void;
  onKeepMine: () => void;
  message?: string;
}

/** Shown when the open note was rewritten elsewhere while it had unsaved edits. */
export function NoteConflictBar({
  onReload,
  onKeepMine,
  message = "This note changed outside the editor.",
}: NoteConflictBarProps) {
  return (
    <div className="note-conflict-bar" role="status" data-testid="note-conflict-bar">
      <span className="note-conflict-bar__text">{message}</span>
      <button type="button" className="btn btn-sm" onClick={onKeepMine}>
        Keep mine
      </button>
      <button type="button" className="btn btn-sm btn-primary" onClick={onReload}>
        Reload
      </button>
    </div>
  );
}
