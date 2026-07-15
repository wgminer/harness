import { describe, expect, it } from "vitest";
import {
  conversationSidebarIconKind,
  formatNewChatLabel,
  formatVoiceDictationTitle,
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

  it("formats empty chat labels with Empty chat @ prefix", () => {
    const title = formatNewChatLabel(Date.parse("2026-06-10T15:45:00"));
    expect(title.startsWith("Empty chat @ ")).toBe(true);
    expect(isTimePlaceholderTitle(title)).toBe(true);
  });

  it("formats voice dictation titles with Dictation @ prefix", () => {
    const title = formatVoiceDictationTitle(new Date("2026-06-10T15:45:00"));
    expect(title.startsWith("Dictation @ ")).toBe(true);
    expect(isTimePlaceholderTitle(title)).toBe(true);
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
