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
      {prompts.map((prompt) => (
        <button
          key={prompt}
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
