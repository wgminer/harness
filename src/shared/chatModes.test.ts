import { describe, expect, it } from "vitest";
import contract from "../../resources/contracts/chatModes.json";
import {
  CHAT_MODES,
  chatModeOverlay,
  chatModePlaceholder,
  DEFAULT_CHAT_MODE,
  getChatMode,
  nextChatMode,
  normalizeChatMode,
} from "./chatModes";

describe("chatModes contract", () => {
  it("exposes Chat and Q&A matching the JSON contract", () => {
    expect(CHAT_MODES.map((m) => m.id)).toEqual(["chat", "qa"]);
    expect(contract.modes.map((m) => m.id)).toEqual(["chat", "qa"]);
  });

  it("keeps Chat as default with no overlay", () => {
    expect(DEFAULT_CHAT_MODE).toBe("chat");
    expect(chatModeOverlay("chat")).toBeNull();
    expect(getChatMode(undefined).id).toBe("chat");
  });

  it("loads Q&A overlay and placeholder from the contract", () => {
    const fromJson = contract.modes.find((m) => m.id === "qa")!;
    expect(chatModeOverlay("qa")).toBe(fromJson.systemOverlay);
    expect(chatModePlaceholder("qa")).toBe(fromJson.placeholder);
    expect(chatModeOverlay("qa")).toContain("[CHAT_MODE: qa]");
  });

  it("maps legacy Decide/Write/Refine to Q&A", () => {
    expect(normalizeChatMode("decide")).toBe("qa");
    expect(normalizeChatMode("write")).toBe("qa");
    expect(normalizeChatMode("refine")).toBe("qa");
    expect(getChatMode("decide").id).toBe("qa");
    expect(chatModeOverlay("refine")).toContain("[CHAT_MODE: qa]");
  });

  it("toggles Chat ↔ Q&A", () => {
    expect(nextChatMode("chat")).toBe("qa");
    expect(nextChatMode("qa")).toBe("chat");
    expect(nextChatMode("decide")).toBe("chat");
  });
});
