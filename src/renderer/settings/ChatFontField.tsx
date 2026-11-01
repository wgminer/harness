import { type ChatFont } from "../../shared/types";
import { applyChatFont } from "../chat/chatFont";

const OPTIONS: ReadonlyArray<{ id: ChatFont; label: string }> = [
  { id: "sans", label: "Sans" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Mono" },
];

export interface ChatFontFieldProps {
  value: ChatFont;
  onChange: (font: ChatFont) => void;
}

export function ChatFontField({ value, onChange }: ChatFontFieldProps) {
  return (
    <div className="settings-section" data-testid="settings-chat-font">
      <label id="settings-chat-font-label">Reply font</label>
      <div
        className="settings-system-prompt-toggle"
        role="radiogroup"
        aria-labelledby="settings-chat-font-label"
      >
        {OPTIONS.map((option) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`settings-system-prompt-toggle__btn${
                selected ? " settings-system-prompt-toggle__btn--active" : ""
              }`}
              onClick={() => {
                applyChatFont(option.id);
                onChange(option.id);
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
