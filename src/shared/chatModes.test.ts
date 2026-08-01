import { describe, expect, it } from "vitest";
import contract from "../../resources/contracts/chatModes.json";
import {
  CHAT_MODES,
  chatModeOverlay,
  chatModePlaceholder,
  DEFAULT_CHAT_MODE,
  getChatMode,
  nextChatMode,
} from "./chatModes";

describe("chatModes contract", () => {
  it("exposes four modes matching the JSON contract", () => {
    expect(CHAT_MODES.map((m) => m.id)).toEqual(["chat", "decide", "write", "refine"]);
    expect(contract.modes.map((m) => m.id)).toEqual(["chat", "decide", "write", "refine"]);
  });

  it("keeps Chat as default with no overlay", () => {
    expect(DEFAULT_CHAT_MODE).toBe("chat");
    expect(chatModeOverlay("chat")).toBeNull();
    expect(getChatMode(undefined).id).toBe("chat");
  });

  it("loads Decide/Write/Refine overlays and placeholders from the contract", () => {
    for (const id of ["decide", "write", "refine"] as const) {
      const fromJson = contract.modes.find((m) => m.id === id)!;
      expect(chatModeOverlay(id)).toBe(fromJson.systemOverlay);
      expect(chatModePlaceholder(id)).toBe(fromJson.placeholder);
      expect(chatModeOverlay(id)).toContain("[CHAT_MODE:");
    }
  });

  it("cycles modes in order", () => {
    expect(nextChatMode("chat")).toBe("decide");
    expect(nextChatMode("decide")).toBe("write");
    expect(nextChatMode("write")).toBe("refine");
    expect(nextChatMode("refine")).toBe("chat");
  });
});
