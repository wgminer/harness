import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { CHAT_MODES, getChatMode, type ChatModeId } from "../shared/chatModes";

const MENU_GAP_PX = 8;

interface ChatModePickerProps {
  value: ChatModeId;
  onChange: (mode: ChatModeId) => void;
  /** `outline` matches reply-strip chip styling (Storybook / legacy). */
  variant?: "quiet" | "outline";
  disabled?: boolean;
}

function ChatModePickerStrip({
  value,
  onChange,
  variant,
  disabled,
}: ChatModePickerProps & { variant: "outline" }) {
  return (
    <div
      className="chat-mode-picker chat-mode-picker--outline"
      role="group"
      aria-label="Chat mode"
    >
      {CHAT_MODES.map((mode) => {
        const active = mode.id === value;
        return (
          <button
            key={mode.id}
            type="button"
            className="btn btn-outline btn-compact chat-pane-btn chat-mode-picker__btn"
            aria-pressed={active}
            disabled={disabled}
            tabIndex={-1}
            data-testid={`chat-mode-${mode.id}`}
            onClick={() => {
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

function ChatModePickerDropdown({
  value,
  onChange,
  disabled,
}: Omit<ChatModePickerProps, "variant">) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const activeMode = getChatMode(value);

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const menuWidth = menuRef.current?.offsetWidth ?? 136;
      setMenuPos({
        top: rect.bottom + MENU_GAP_PX,
        left: Math.max(MENU_GAP_PX, rect.right - menuWidth),
      });
    };
    update();
    requestAnimationFrame(update);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  const menu = open
      ? createPortal(
          <div
            ref={menuRef}
            className="chat-mode-picker__menu chat-mode-picker__menu--portal"
            role="menu"
            aria-label="Chat mode"
            style={
              menuPos
                ? { top: menuPos.top, left: menuPos.left }
                : { top: 0, left: 0, visibility: "hidden" }
            }
          >
            {CHAT_MODES.map((mode) => {
              const active = mode.id === value;
              return (
                <button
                  key={mode.id}
                  type="button"
                  className={`chat-mode-picker__menu-item${active ? " chat-mode-picker__menu-item--active" : ""}`}
                  role="menuitem"
                  aria-current={active ? "true" : undefined}
                  data-testid={`chat-mode-${mode.id}`}
                  onClick={() => {
                    setOpen(false);
                    if (mode.id !== value) onChange(mode.id);
                  }}
                >
                  <span>{mode.label}</span>
                  {active ? <Check size={14} className="chat-mode-picker__menu-check" aria-hidden /> : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div
      ref={wrapRef}
      className="chat-mode-picker chat-mode-picker--dropdown"
    >
      <button
        ref={triggerRef}
        type="button"
        className="btn chat-pane-btn voice-btn chat-mode-picker__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Chat mode: ${activeMode.label}`}
        disabled={disabled}
        tabIndex={-1}
        data-testid="chat-mode-trigger"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="chat-mode-picker__trigger-label">{activeMode.label}</span>
        <ChevronDown size={15} className="chat-mode-picker__trigger-chevron" aria-hidden />
      </button>
      {menu}
    </div>
  );
}

export function ChatModePicker({
  value,
  onChange,
  variant = "quiet",
  disabled,
}: ChatModePickerProps) {
  if (variant === "outline") {
    return (
      <ChatModePickerStrip
        value={value}
        onChange={onChange}
        variant={variant}
        disabled={disabled}
      />
    );
  }

  return <ChatModePickerDropdown value={value} onChange={onChange} disabled={disabled} />;
}
