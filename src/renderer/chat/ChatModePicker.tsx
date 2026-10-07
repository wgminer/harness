import { useLayoutEffect, useRef, useState } from "react";
import { Flame, MessageCircle, type LucideIcon } from "lucide-react";
import { CHAT_MODES, getChatMode, type ChatModeId } from "../../shared/chatModes";

interface ChatModePickerProps {
  value: ChatModeId;
  onChange: (mode: ChatModeId) => void;
  /** `outline` matches reply-strip chip styling (Storybook / legacy). */
  variant?: "quiet" | "outline";
  disabled?: boolean;
}

const MODE_ICONS: Record<ChatModeId, LucideIcon> = {
  chat: MessageCircle,
  qa: Flame,
};

/** Two-way Chat | Grill segmented control. Icon-only; mode name is the aria-label / title. */
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
  // Re-measure on resize so the thumb follows the compact composer size.
  useLayoutEffect(() => {
    if (variant !== "quiet") return;
    const group = groupRef.current;
    if (!group) return;
    const place = () => {
      const active = group.querySelector<HTMLElement>(".chat-mode-picker__seg--active");
      if (!active) return;
      group.style.setProperty("--seg-thumb-x", `${active.offsetLeft}px`);
      group.style.setProperty("--seg-thumb-w", `${active.offsetWidth}px`);
    };
    place();
    if (!thumbReady) requestAnimationFrame(() => setThumbReady(true));
    const observer = new ResizeObserver(place);
    observer.observe(group);
    return () => observer.disconnect();
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
        const Icon = MODE_ICONS[mode.id];
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
            data-mode={mode.id}
            aria-label={mode.label}
            title={mode.label}
            onClick={() => {
              if (mode.id !== activeMode.id) onChange(mode.id);
            }}
          >
            {variant === "quiet" ? (
              <Icon className="chat-mode-picker__icon" size={14} strokeWidth={2} aria-hidden />
            ) : (
              mode.label
            )}
          </button>
        );
      })}
    </div>
  );
}
