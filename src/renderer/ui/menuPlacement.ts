export const MENU_GAP_PX = 4;
export const MENU_VIEWPORT_MARGIN_PX = 8;

/** Preferred side of the anchor, then alignment along it. Flips when the preferred side lacks room. */
export type MenuPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end" | "right-start";

export type MenuSide = "top" | "bottom" | "left" | "right";

export interface MenuAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface MenuPosition {
  top: number;
  left: number;
  /** Side of the anchor the menu actually opened on (drives the animation origin). */
  side: MenuSide;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

/** Place a fixed-position menu next to its anchor, flipping to the roomier side and clamping to the viewport. */
export function placeMenu(
  anchor: MenuAnchorRect,
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: MenuPlacement = "bottom-start",
  gap = MENU_GAP_PX,
): MenuPosition {
  const margin = MENU_VIEWPORT_MARGIN_PX;
  const maxLeft = viewport.width - menu.width - margin;
  const maxTop = viewport.height - menu.height - margin;

  if (placement === "right-start") {
    const spaceRight = viewport.width - anchor.right;
    const side: MenuSide =
      spaceRight < menu.width + gap && anchor.left > spaceRight ? "left" : "right";
    const left = side === "right" ? anchor.right + gap : anchor.left - gap - menu.width;
    return { top: clamp(anchor.top, margin, maxTop), left: clamp(left, margin, maxLeft), side };
  }

  const [preferred, align] = placement.split("-") as ["top" | "bottom", "start" | "end"];
  const spaceBelow = viewport.height - anchor.bottom;
  const spaceAbove = anchor.top;
  const needed = menu.height + gap;
  let side: MenuSide = preferred;
  if (preferred === "bottom" && spaceBelow < needed && spaceAbove > spaceBelow) side = "top";
  if (preferred === "top" && spaceAbove < needed && spaceBelow > spaceAbove) side = "bottom";

  const top = side === "bottom" ? anchor.bottom + gap : anchor.top - gap - menu.height;
  const left = align === "end" ? anchor.right - menu.width : anchor.left;
  return { top: clamp(top, margin, maxTop), left: clamp(left, margin, maxLeft), side };
}
