import { describe, expect, it } from "vitest";
import { conversationDisplayTitle, formatNewChatLabel } from "./chatDisplayTitle";

describe("chatDisplayTitle", () => {
  it("uses title when non-empty", () => {
    expect(conversationDisplayTitle("Hello", Date.now())).toBe("Hello");
  });

  it("falls back to new chat label for empty title", () => {
    const createdAt = 1_700_000_000_000;
    expect(conversationDisplayTitle("   ", createdAt)).toBe(formatNewChatLabel(createdAt));
  });
});
