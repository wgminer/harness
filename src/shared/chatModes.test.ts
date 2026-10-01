import { describe, expect, it } from "vitest";
import contract from "../../resources/contracts/chatModes.json";
import {
  CHAT_MODES,
  chatModeOverlay,
  chatModePlaceholder,
  chatModePlaceholders,
  DEFAULT_CHAT_MODE,
  getChatMode,
  initialPlaceholderCycle,
  nextChatMode,
  normalizeChatMode,
  placeholderCycleForMode,
  placeholderCycleOnConversationChange,
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
    expect(chatModePlaceholder("qa")).toBe(fromJson.placeholders[0]);
    expect(chatModeOverlay("qa")).toContain("[CHAT_MODE: qa]");
  });

  it("gives each mode its own placeholder series", () => {
    for (const mode of contract.modes) {
      expect(mode.placeholders.length).toBeGreaterThanOrEqual(4);
      expect(new Set(mode.placeholders).size).toBe(mode.placeholders.length);
      expect(mode.placeholders.every((line) => line.trim().length > 0)).toBe(true);
    }
    const chat = chatModePlaceholders("chat");
    const qa = chatModePlaceholders("qa");
    expect(chat[0]).toBe("Write a message…");
    expect(qa[0]).toBe("What should I grill you on…");
    expect(chatModePlaceholder("chat", chat.length)).toBe(chat[0]);
    expect(chatModePlaceholder("qa", -1)).toBe(qa[qa.length - 1]);
  });

  it("advances a mode's placeholder only when that mode is entered again", () => {
    let cycle = initialPlaceholderCycle("chat");
    expect(chatModePlaceholder(cycle.mode, cycle.index)).toBe("Write a message…");

    cycle = placeholderCycleForMode(cycle, "chat");
    expect(chatModePlaceholder(cycle.mode, cycle.index)).toBe("Write a message…");

    cycle = placeholderCycleForMode(cycle, "qa");
    expect(chatModePlaceholder(cycle.mode, cycle.index)).toBe(
      "What should I grill you on…",
    );

    cycle = placeholderCycleForMode(cycle, "chat");
    expect(chatModePlaceholder(cycle.mode, cycle.index)).toBe("What's on your mind…");

    cycle = placeholderCycleForMode(cycle, "qa");
    expect(chatModePlaceholder(cycle.mode, cycle.index)).toBe("Pitch the plan. I'll poke holes…");
  });

  it("restarts the series when opening a thread, and keeps it when compose is saved", () => {
    const onCompose = initialPlaceholderCycle("chat");
    const saved = placeholderCycleOnConversationChange(onCompose, null, "conv-1", "chat");
    expect(saved).toBe(onCompose);

    const openedQa = placeholderCycleOnConversationChange(onCompose, null, "conv-qa", "qa");
    expect(chatModePlaceholder(openedQa.mode, openedQa.index)).toBe(
      "What should I grill you on…",
    );
    const firstChatAfterOpen = placeholderCycleForMode(openedQa, "chat");
    expect(chatModePlaceholder(firstChatAfterOpen.mode, firstChatAfterOpen.index)).toBe(
      "Write a message…",
    );
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
