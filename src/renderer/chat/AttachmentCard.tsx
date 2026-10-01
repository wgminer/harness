import type { ReactNode } from "react";
import { X } from "lucide-react";

interface AttachmentCardProps {
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  /** `paste` is a little taller and wraps its preview onto two lines. */
  variant?: "paste" | "file";
  /** Card click, e.g. moving pasted text back into the draft. */
  onOpen?: () => void;
  openLabel?: string;
  onRemove: () => void;
  removeLabel: string;
  disabled?: boolean;
  removeDisabled?: boolean;
}

/** One staged attachment in the composer strip (pasted text, text file, or audio). */
export function AttachmentCard({
  icon,
  title,
  meta,
  variant = "file",
  onOpen,
  openLabel,
  onRemove,
  removeLabel,
  disabled = false,
  removeDisabled = disabled,
}: AttachmentCardProps) {
  const body = (
    <>
      <span className="chat-attach-card__title">{title}</span>
      <span className="chat-attach-card__meta">
        {icon}
        <span className="chat-attach-card__meta-text">{meta}</span>
      </span>
    </>
  );
  return (
    <div className={`chat-attach-card chat-attach-card--${variant}`}>
      {onOpen ? (
        <button
          type="button"
          className="chat-attach-card__main"
          onClick={onOpen}
          disabled={disabled}
          aria-label={openLabel}
          title={openLabel}
        >
          {body}
        </button>
      ) : (
        <div className="chat-attach-card__main" title={title}>
          {body}
        </div>
      )}
      <button
        type="button"
        className="chat-attach-card__remove"
        onClick={onRemove}
        disabled={removeDisabled}
        aria-label={removeLabel}
        title={removeLabel}
      >
        <X size={12} strokeWidth={1.75} />
      </button>
    </div>
  );
}
