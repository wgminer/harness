import { useEffect, useRef } from "react";

interface DictationSuggestedPromptChipsProps {
  prompts: string[];
  onSelect: (prompt: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

/** Reply-strip chips: suggested follow-up user messages after dictation. */
export function DictationSuggestedPromptChips({
  prompts,
  onSelect,
  disabled,
  loading,
}: DictationSuggestedPromptChipsProps) {
  const firstChipRef = useRef<HTMLButtonElement>(null);
  const ready = !loading && !disabled && prompts.length > 0;

  /** Focus the first chip once it is actionable so Enter runs it. */
  useEffect(() => {
    if (!ready) return;
    const active = document.activeElement as HTMLElement | null;
    const editingElsewhere =
      active != null &&
      active !== document.body &&
      (active.isContentEditable || active.matches("input, textarea, select"));
    if (!editingElsewhere) firstChipRef.current?.focus();
  }, [ready]);

  if (loading && prompts.length === 0) {
    return (
      <div
        className="dictation-suggested-prompts"
        role="status"
        aria-label="Loading suggested prompts"
        data-testid="dictation-suggested-prompts-loading"
      >
        {/* Same btn classes as the real chip so size/position match; "Run" sizes the label. */}
        <button
          type="button"
          className="btn btn-outline btn-compact chat-pane-btn dictation-suggested-prompts__chip dictation-suggested-prompts__chip--loading"
          disabled
          tabIndex={-1}
          aria-hidden
        >
          Run
        </button>
      </div>
    );
  }

  if (prompts.length === 0) return null;

  return (
    <div
      className="dictation-suggested-prompts"
      role="group"
      aria-label="Suggested prompts"
      data-testid="dictation-suggested-prompts"
    >
      {prompts.map((prompt, i) => (
        <button
          key={prompt}
          ref={i === 0 ? firstChipRef : undefined}
          type="button"
          className="btn btn-outline btn-compact chat-pane-btn dictation-suggested-prompts__chip"
          disabled={disabled}
          data-testid="dictation-suggested-prompt"
          onClick={() => onSelect(prompt)}
        >
          {prompt}
        </button>
      ))}
    </div>
  );
}
