export const CHAT_MODE_MENU_GAP_PX = 8;
export const CHAT_MODE_MENU_FALLBACK_WIDTH_PX = 136;
export const CHAT_MODE_MENU_FALLBACK_HEIGHT_PX = 160;

export type ChatModeMenuPlacement = "up" | "down";

export interface ChatModeMenuPosition {
  top: number;
  left: number;
  placement: ChatModeMenuPlacement;
}

/** Place the chat-mode menu below a centered composer, above a bottom-docked one. */
export function placeChatModeMenu(
  trigger: Pick<DOMRect, "top" | "bottom" | "right">,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = CHAT_MODE_MENU_GAP_PX,
): ChatModeMenuPosition {
  const width = menu.width > 0 ? menu.width : CHAT_MODE_MENU_FALLBACK_WIDTH_PX;
  const height = menu.height > 0 ? menu.height : CHAT_MODE_MENU_FALLBACK_HEIGHT_PX;
  const spaceBelow = viewport.height - trigger.bottom;
  const spaceAbove = trigger.top;
  const neededBelow = height + gap;
  const placement: ChatModeMenuPlacement =
    spaceBelow < neededBelow && spaceAbove > spaceBelow ? "up" : "down";

  const top = placement === "up" ? trigger.top - gap - height : trigger.bottom + gap;
  const maxLeft = Math.max(gap, viewport.width - width - gap);
  const left = Math.min(Math.max(gap, trigger.right - width), maxLeft);

  return { top, left, placement };
}
