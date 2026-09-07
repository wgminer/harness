import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Visible heading; may be animated. Prefer a stable accessible name via ariaLabel when non-text. */
  title: ReactNode;
  /** Accessible name when `title` is not plain text (e.g. scramble reveal). */
  ariaLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** When true, backdrop, Escape, and close button do not dismiss. */
  closeDisabled?: boolean;
  /** Hide the header close control (e.g. while an entrance animation runs). */
  hideClose?: boolean;
  /** Scrollable body with max-height (e.g. task editor). */
  variant?: "default" | "scrollable";
  /** Panel max-width: default 440px, lg ~720px. */
  size?: "default" | "lg";
  footerClassName?: string;
  "data-testid"?: string;
}

export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  footer,
  closeDisabled = false,
  hideClose = false,
  variant = "default",
  size = "default",
  footerClassName,
  "data-testid": testId,
}: ModalProps) {
  const uid = useId();
  const titleId = `${uid}-title`;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !closeDisabled) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeDisabled, onClose]);

  if (!open) return null;

  const panelClass = [
    "app-modal",
    size === "lg" ? "app-modal--lg" : null,
    variant === "scrollable" ? "app-modal--scrollable" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className="app-modal-backdrop"
      role="presentation"
      data-testid={testId}
      onClick={(e) => {
        if (e.target === e.currentTarget && !closeDisabled) onClose();
      }}
    >
      <div
        className={panelClass}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-modal-header">
          <h3 id={titleId} className="app-modal-heading" aria-label={ariaLabel}>
            {title}
          </h3>
          <button
            type="button"
            className={[
              "btn btn-icon-sm app-modal-close",
              hideClose ? "app-modal-close--hidden" : null,
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={onClose}
            disabled={closeDisabled || hideClose}
            tabIndex={hideClose ? -1 : undefined}
            aria-hidden={hideClose || undefined}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="app-modal-body">{children}</div>
        {footer != null && (
          <div
            className={["app-modal-footer", footerClassName].filter(Boolean).join(" ")}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
