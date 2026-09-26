import { describe, expect, it } from "vitest";
import { resolveConversationId } from "./useConversations";
import type { Conversation } from "../sidebar/sidebarUtils";

const row = (id: string, hasMessages: boolean): Conversation => ({
  id,
  title: null,
  createdAt: 0,
  sessionKind: "chat",
  hasMessages,
});

describe("resolveConversationId", () => {
  it("returns null for an empty list", () => {
    expect(resolveConversationId([], "a")).toBeNull();
  });

  it("keeps the preferred id when it is visible", () => {
    expect(resolveConversationId([row("a", true), row("b", true)], "b")).toBe("b");
  });

  it("falls back to the first visible row when the preferred one is hidden or gone", () => {
    const list = [row("empty", false), row("a", true), row("b", true)];
    expect(resolveConversationId(list, "empty")).toBe("a");
    expect(resolveConversationId(list, "missing")).toBe("a");
    expect(resolveConversationId(list, null)).toBe("a");
  });

  it("returns null when nothing is visible", () => {
    expect(resolveConversationId([row("empty", false)], null)).toBeNull();
  });
});
