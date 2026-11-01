import { describe, expect, it } from "vitest";
import { MENU_VIEWPORT_MARGIN_PX, placeMenu } from "./menuPlacement";

const menu = { width: 136, height: 160 };
const viewport = { width: 1200, height: 800 };
const gap = 8;

describe("placeMenu", () => {
  it("opens below a vertically centered composer, right-aligned", () => {
    const anchor = { top: 360, bottom: 396, left: 784, right: 820 };
    const pos = placeMenu(anchor, menu, viewport, "bottom-end", gap);
    expect(pos.side).toBe("bottom");
    expect(pos.top).toBe(anchor.bottom + gap);
    expect(pos.left).toBe(anchor.right - menu.width);
  });

  it("flips above a bottom-docked composer", () => {
    const anchor = { top: 748, bottom: 784, left: 784, right: 820 };
    const pos = placeMenu(anchor, menu, viewport, "bottom-end", gap);
    expect(pos.side).toBe("top");
    expect(pos.top).toBe(anchor.top - gap - menu.height);
  });

  it("left-aligns start placements and clamps to the viewport edge", () => {
    const anchor = { top: 40, bottom: 60, left: 1150, right: 1170 };
    const pos = placeMenu(anchor, menu, viewport, "bottom-start");
    expect(pos.left).toBe(viewport.width - menu.width - MENU_VIEWPORT_MARGIN_PX);
  });

  it("opens submenus to the right, flipping left when the right edge is tight", () => {
    const row = { top: 100, bottom: 130, left: 20, right: 200 };
    expect(placeMenu(row, menu, viewport, "right-start").side).toBe("right");
    const tight = { top: 100, bottom: 130, left: 1000, right: 1180 };
    const pos = placeMenu(tight, menu, viewport, "right-start");
    expect(pos.side).toBe("left");
    expect(pos.left + menu.width).toBeLessThanOrEqual(tight.left);
  });

  it("centers the first item's icon over the anchor for over-start", () => {
    const anchor = { top: 100, bottom: 128, left: 200, right: 228 };
    const pos = placeMenu(anchor, menu, viewport, "over-start", gap, { x: 18, y: 20 });
    expect(pos.side).toBe("over");
    expect(pos.top).toBe(114 - 20);
    expect(pos.left).toBe(214 - 18);
  });
});
