import { describe, expect, it } from "vitest";
import {
  conversationDisplayTitle,
  formatNewChatLabel,
  isConversationTitlePending,
} from "./chatDisplayTitle";

describe("chatDisplayTitle", () => {
  it("uses title when non-empty", () => {
    expect(conversationDisplayTitle("Hello")).toBe("Hello");
  });

  it("shows legacy time placeholders as stored", () => {
    expect(conversationDisplayTitle("Dictation @ 3:45 PM")).toBe("Dictation @ 3:45 PM");
    expect(conversationDisplayTitle("New chat @ 3:45 PM")).toBe("New chat @ 3:45 PM");
  });

  it("falls back to empty chat label when title is empty", () => {
    const createdAt = 1_700_000_000_000;
    expect(conversationDisplayTitle("   ", createdAt)).toBe(formatNewChatLabel(createdAt));
  });

  it("uses skeleton state while title LLM runs on a placeholder", () => {
    expect(isConversationTitlePending(null, true)).toBe(true);
    expect(isConversationTitlePending("Dictation @ 3:45 PM", true)).toBe(true);
    expect(isConversationTitlePending("Weekly plan", true)).toBe(false);
    expect(isConversationTitlePending(null, false)).toBe(false);
  });
});
