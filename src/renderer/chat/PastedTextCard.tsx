import { useState } from "react";
import { ChevronDown, FileText } from "lucide-react";
import { pastedTextPreview, pastedTextSizeLabel } from "./pastedText";

/** A large paste in a sent user message, collapsed to one row until opened. */
export function PastedTextCard({ text, name }: { text: string; name?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`message-pasted-card${open ? " message-pasted-card--open" : ""}`}>
      <button
        type="button"
        className="message-pasted-card__header"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <FileText size={13} strokeWidth={1.75} aria-hidden />
        <span className="message-pasted-card__title">{name ?? "Pasted text"}</span>
        {name ? null : <span className="message-pasted-card__preview">{pastedTextPreview(text)}</span>}
        <span className="message-pasted-card__meta">{pastedTextSizeLabel(text)}</span>
        <ChevronDown size={14} strokeWidth={1.75} className="message-pasted-card__chevron" aria-hidden />
      </button>
      {open ? <pre className="message-pasted-card__body">{text}</pre> : null}
    </div>
  );
}
