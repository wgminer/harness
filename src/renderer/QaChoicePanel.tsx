import type { CSSProperties } from "react";

interface QaChoicePanelProps {
  options: string[];
  onSelect: (label: string) => void;
  disabled?: boolean;
  /** Grow the dock open after a turn, once the question text has landed. */
  arrive?: boolean;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Stacked lettered multiple-choice rows for Q&A mode (composer dock). */
export function QaChoicePanel({ options, onSelect, disabled, arrive }: QaChoicePanelProps) {
  if (options.length < 2) return null;
  return (
    <div
      className={`qa-choice-panel${arrive ? " qa-choice-panel--arrive" : ""}`}
      role="group"
      aria-label="Answer choices"
    >
      <div className="qa-choice-panel__clip">
        <div className="qa-choice-panel__stack">
          {options.map((label, index) => {
            const letter = LETTERS[index] ?? String(index + 1);
            return (
              <button
                key={`${letter}:${label}`}
                type="button"
                className="qa-choice-panel__row"
                disabled={disabled}
                data-testid={`qa-choice-${index}`}
                style={{ "--qa-row": index } as CSSProperties}
                onClick={() => onSelect(label)}
              >
                <span className="qa-choice-panel__letter" aria-hidden>
                  {letter}
                </span>
                <span className="qa-choice-panel__label">{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
