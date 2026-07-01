import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** When true, backdrop, Escape, and close button do not dismiss. */
  closeDisabled?: boolean;
  /** Scrollable body with max-height (e.g. task editor). */
  variant?: "default" | "scrollable";
  footerClassName?: string;
  "data-testid"?: string;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  closeDisabled = false,
  variant = "default",
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
        className={`app-modal${variant === "scrollable" ? " app-modal--scrollable" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="app-modal-header">
          <h3 id={titleId} className="app-modal-heading">
            {title}
          </h3>
          <button
            type="button"
            className="btn btn-icon app-modal-close"
            onClick={onClose}
            disabled={closeDisabled}
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
