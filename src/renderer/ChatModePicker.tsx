import { CHAT_MODES, getChatMode, type ChatModeId } from "../shared/chatModes";

interface ChatModePickerProps {
  value: ChatModeId;
  onChange: (mode: ChatModeId) => void;
  /** `outline` matches reply-strip chip styling (Storybook / legacy). */
  variant?: "quiet" | "outline";
  disabled?: boolean;
}

/** Two-way Chat | Q&A segmented control. */
export function ChatModePicker({
  value,
  onChange,
  variant = "quiet",
  disabled,
}: ChatModePickerProps) {
  const activeMode = getChatMode(value);
  return (
    <div
      className={`chat-mode-picker chat-mode-picker--segment${
        variant === "outline" ? " chat-mode-picker--outline" : " chat-mode-picker--quiet"
      }`}
      role="group"
      aria-label="Chat mode"
    >
      {CHAT_MODES.map((mode) => {
        const active = mode.id === activeMode.id;
        return (
          <button
            key={mode.id}
            type="button"
            className={
              variant === "outline"
                ? "btn btn-outline btn-compact chat-pane-btn chat-mode-picker__btn"
                : `chat-mode-picker__seg${active ? " chat-mode-picker__seg--active" : ""}`
            }
            aria-pressed={active}
            disabled={disabled}
            tabIndex={-1}
            data-testid={`chat-mode-${mode.id}`}
            onClick={() => {
              if (mode.id !== activeMode.id) onChange(mode.id);
            }}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
