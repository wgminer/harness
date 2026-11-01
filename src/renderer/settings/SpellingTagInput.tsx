import { useState, type Dispatch, type KeyboardEvent, type SetStateAction } from "react";
import { X } from "lucide-react";

/** Adds `raw` (trimmed) unless it is empty or already present, ignoring case. */
export function addSpelling(terms: string[], raw: string): string[] {
  const term = raw.trim();
  if (!term) return terms;
  if (terms.some((entry) => entry.toLowerCase() === term.toLowerCase())) return terms;
  return [...terms, term];
}

export interface SpellingTagInputProps {
  id: string;
  terms: string[];
  setTerms: Dispatch<SetStateAction<string[]>>;
}

/** Preferred spellings as removable tags; Enter or a comma adds, Backspace on empty removes the last. */
export function SpellingTagInput({ id, terms, setTerms }: SpellingTagInputProps) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    if (!draft.trim()) return;
    setTerms((prev) => addSpelling(prev, draft));
    setDraft("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
      return;
    }
    if (e.key === "Backspace" && draft === "" && terms.length > 0) {
      e.preventDefault();
      setTerms((prev) => prev.slice(0, -1));
    }
  };

  return (
    <div className="settings-tag-input" data-testid="settings-spellings">
      {terms.map((term) => (
        <span key={term} className="settings-tag">
          {term}
          <button
            type="button"
            className="settings-tag__remove"
            aria-label={`Remove ${term}`}
            onClick={() => setTerms((prev) => prev.filter((entry) => entry !== term))}
          >
            <X size={12} strokeWidth={2} aria-hidden />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="settings-tag-input__field"
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        placeholder={terms.length === 0 ? "Add a name or term, then press Enter" : "Add another"}
        autoComplete="off"
        spellCheck={false}
      />
    </div>
  );
}
