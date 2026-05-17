import { Pencil, Trash2 } from "lucide-react";

interface SettingsEntryRowProps {
  title: string;
  detail?: string;
  onEdit: () => void;
  onDelete?: () => void;
  editAriaLabel: string;
  deleteAriaLabel?: string;
  /** Native tooltip on the edit button (default "Edit") */
  editButtonTitle?: string;
}

export function SettingsEntryRow({
  title,
  detail,
  onEdit,
  onDelete,
  editAriaLabel,
  deleteAriaLabel,
  editButtonTitle = "Edit",
}: SettingsEntryRowProps) {
  return (
    <div className="settings-entry-row">
      <div className="settings-entry-row__body">
        <div className="settings-entry-row__title">{title}</div>
        {detail !== undefined ? (
          <div className="settings-entry-row__detail">{detail === "" ? "—" : detail}</div>
        ) : null}
      </div>
      <div className="settings-entry-row__actions">
        <button
          type="button"
          className="btn btn-icon"
          data-action="edit"
          onClick={onEdit}
          aria-label={editAriaLabel}
          title={editButtonTitle}
        >
          <Pencil size={16} />
        </button>
        {onDelete != null && deleteAriaLabel != null ? (
          <button
            type="button"
            className="btn btn-icon"
            data-action="delete"
            onClick={onDelete}
            aria-label={deleteAriaLabel}
            title="Remove"
          >
            <Trash2 size={16} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

export type { SettingsEntryRowProps };
