import { Pencil, Trash2 } from "lucide-react";

function collapseToSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface SettingsEntryRowProps {
  title: string;
  detail?: string;
  onEdit: () => void;
  onDelete?: () => void;
  editAriaLabel: string;
  deleteAriaLabel?: string;
  /** Native tooltip on the edit button (default "Edit") */
  editButtonTitle?: string;
  /** Show detail on one line with ellipsis when it overflows */
  detailSingleLine?: boolean;
  /** Hide edit/delete controls until the row is hovered or focused */
  actionsOnHover?: boolean;
}

export function SettingsEntryRow({
  title,
  detail,
  onEdit,
  onDelete,
  editAriaLabel,
  deleteAriaLabel,
  editButtonTitle = "Edit",
  detailSingleLine = false,
  actionsOnHover = false,
}: SettingsEntryRowProps) {
  const rowClass = [
    "settings-entry-row",
    actionsOnHover ? "settings-entry-row--actions-on-hover" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const detailClass = [
    "settings-entry-row__detail",
    detailSingleLine ? "settings-entry-row__detail--single-line" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const detailText =
    detail === undefined ? undefined : detail === "" ? "—" : detailSingleLine ? collapseToSingleLine(detail) : detail;

  return (
    <div className={rowClass}>
      <div className="settings-entry-row__body">
        <div className="settings-entry-row__title">{title}</div>
        {detailText !== undefined ? (
          <div
            className={detailClass}
            title={detailSingleLine && detail ? detail : undefined}
          >
            {detailText}
          </div>
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
