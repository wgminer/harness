import { describe, expect, it } from "vitest";
import { CHAT_MODE_MENU_GAP_PX, placeChatModeMenu } from "./chatModeMenuPosition";

const menu = { width: 136, height: 160 };
const viewport = { width: 1200, height: 800 };

describe("placeChatModeMenu", () => {
  it("opens down when the composer is vertically centered", () => {
    const trigger = { top: 360, bottom: 396, right: 820 };
    const pos = placeChatModeMenu(trigger, menu, viewport);
    expect(pos.placement).toBe("down");
    expect(pos.top).toBe(trigger.bottom + CHAT_MODE_MENU_GAP_PX);
    expect(pos.left).toBe(trigger.right - menu.width);
  });

  it("opens up when the composer is docked at the bottom", () => {
    const trigger = { top: 748, bottom: 784, right: 820 };
    const pos = placeChatModeMenu(trigger, menu, viewport);
    expect(pos.placement).toBe("up");
    expect(pos.top).toBe(trigger.top - CHAT_MODE_MENU_GAP_PX - menu.height);
    expect(pos.left).toBe(trigger.right - menu.width);
  });
});
