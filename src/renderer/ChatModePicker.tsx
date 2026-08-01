import { CHAT_MODES, type ChatModeId } from "../shared/chatModes";

interface ChatModePickerProps {
  value: ChatModeId;
  onChange: (mode: ChatModeId) => void;
  /**
   * When set, every mode press (including the active one) calls this instead of
   * onChange — used by the dictation reply strip as “continue in this mode”.
   */
  onSelect?: (mode: ChatModeId) => void;
  /** `outline` matches the old Continue control in the reply strip. */
  variant?: "quiet" | "outline";
  disabled?: boolean;
}

export function ChatModePicker({
  value,
  onChange,
  onSelect,
  variant = "quiet",
  disabled,
}: ChatModePickerProps) {
  return (
    <div
      className={`chat-mode-picker${variant === "outline" ? " chat-mode-picker--outline" : ""}`}
      role="group"
      aria-label="Chat mode"
    >
      {CHAT_MODES.map((mode) => {
        const active = mode.id === value;
        const className =
          variant === "outline"
            ? "btn btn-outline btn-compact chat-pane-btn chat-mode-picker__btn"
            : `chat-mode-picker__btn${active ? " chat-mode-picker__btn--active" : ""}`;
        return (
          <button
            key={mode.id}
            type="button"
            className={className}
            aria-pressed={variant === "outline" ? undefined : active}
            disabled={disabled}
            tabIndex={-1}
            data-testid={`chat-mode-${mode.id}`}
            onClick={() => {
              if (onSelect) {
                onSelect(mode.id);
                return;
              }
              if (mode.id !== value) onChange(mode.id);
            }}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
