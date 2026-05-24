import { describe, expect, it } from "vitest";
import { shouldRefineConversationTitle } from "./conversationTitlePolicy";
import type { ChatMessage } from "./types";

function msgs(...pairs: Array<["user" | "assistant", string]>): ChatMessage[] {
  return pairs.map(([role, content]) => ({ role, content }));
}

describe("shouldRefineConversationTitle", () => {
  it("runs on first user message without assistant when title is empty", () => {
    expect(shouldRefineConversationTitle(msgs(["user", "buy milk"]), null)).toBe(true);
  });

  it("runs on legacy dictation time placeholder", () => {
    expect(
      shouldRefineConversationTitle(msgs(["user", "buy milk"]), "Dictation @ 3:45 PM")
    ).toBe(true);
  });

  it("skips user-only thread that already has a real title", () => {
    expect(
      shouldRefineConversationTitle(msgs(["user", "buy milk"]), "Grocery list")
    ).toBe(false);
  });

  it("skips extra user messages before any assistant reply", () => {
    expect(
      shouldRefineConversationTitle(msgs(["user", "a"], ["user", "b"]), null)
    ).toBe(false);
  });

  it("runs on first assistant reply", () => {
    expect(
      shouldRefineConversationTitle(msgs(["user", "a"], ["assistant", "b"]))
    ).toBe(true);
  });
});
