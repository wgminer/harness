import { useLayoutEffect, useRef, useState } from "react";
import { CHAT_MODES, getChatMode, type ChatModeId } from "../../shared/chatModes";

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
  const groupRef = useRef<HTMLDivElement>(null);
  const [thumbReady, setThumbReady] = useState(false);

  // Slide the thumb under the active segment; first placement is instant.
  useLayoutEffect(() => {
    if (variant !== "quiet") return;
    const group = groupRef.current;
    const active = group?.querySelector<HTMLElement>(".chat-mode-picker__seg--active");
    if (!group || !active) return;
    group.style.setProperty("--seg-thumb-x", `${active.offsetLeft}px`);
    group.style.setProperty("--seg-thumb-w", `${active.offsetWidth}px`);
    if (!thumbReady) requestAnimationFrame(() => setThumbReady(true));
  }, [activeMode.id, variant, thumbReady]);

  return (
    <div
      ref={groupRef}
      className={`chat-mode-picker chat-mode-picker--segment${
        variant === "outline" ? " chat-mode-picker--outline" : " chat-mode-picker--quiet"
      }${thumbReady ? " chat-mode-picker--thumb-ready" : ""}`}
      role="group"
      aria-label="Chat mode"
    >
      {variant === "quiet" && <span className="chat-mode-picker__thumb" aria-hidden />}
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
