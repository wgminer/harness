import { describe, expect, it } from "vitest";
import {
  conversationSidebarIconKind,
  isSidebarVisibleConversation,
  isTimePlaceholderTitle,
} from "./conversationSession";

describe("conversationSession", () => {
  it("detects time placeholder titles", () => {
    expect(isTimePlaceholderTitle(null)).toBe(true);
    expect(isTimePlaceholderTitle("Dictation @ 3:45 PM")).toBe(true);
    expect(isTimePlaceholderTitle("New chat @ 3:45 PM")).toBe(true);
    expect(isTimePlaceholderTitle("Empty chat @ 3:45 PM")).toBe(true);
    expect(isTimePlaceholderTitle("Weekly planning")).toBe(false);
  });

  it("hides message-less conversations from compose-first sidebar", () => {
    expect(isSidebarVisibleConversation({ id: "a", title: null, createdAt: 1 })).toBe(false);
    expect(
      isSidebarVisibleConversation({ id: "b", title: "Hi", createdAt: 1, hasMessages: true })
    ).toBe(true);
  });

  it("picks sidebar icon from session kind and assistant replies", () => {
    expect(
      conversationSidebarIconKind({
        title: null,
        sessionKind: "dictation",
        hasAssistantReply: false,
      })
    ).toBe("dictation");
    expect(
      conversationSidebarIconKind({
        title: "Summarized topic",
        sessionKind: "dictation",
        hasAssistantReply: true,
      })
    ).toBe("chat");
    expect(
      conversationSidebarIconKind({
        title: "Hello",
        sessionKind: "chat",
      })
    ).toBe("chat");
  });
});
