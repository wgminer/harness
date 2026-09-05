import { describe, expect, it } from "vitest";
import { assembleBrowserSystemPrompt, buildRecentConversationsBlock } from "./browserPrompt";
import { createBrowserStore, memoryStorage, type BrowserConversation } from "./browserStore";

describe("buildRecentConversationsBlock", () => {
  it("returns empty when there are no other chats", () => {
    expect(buildRecentConversationsBlock([])).toBe("");
  });

  it("includes another chat and skips the current one", () => {
    const other: BrowserConversation = {
      id: "conv_other",
      title: "Sidebar bug",
      createdAt: 1,
      sessionKind: "chat",
      hasAssistantReply: true,
      hasMessages: true,
      messages: [
        { role: "user", content: "The list jumps", timestamp: 2 },
        { role: "assistant", content: "Here is the fix", timestamp: 3 },
      ],
    };
    const block = buildRecentConversationsBlock([other], "conv_current", 4);
    expect(block).toContain("[RECENT_CONVERSATIONS]");
    expect(block).toContain("Sidebar bug");
    expect(block).toContain("User: The list jumps");
  });
});

describe("assembleBrowserSystemPrompt", () => {
  it("includes the desktop static prompt and temporal context", () => {
    const store = createBrowserStore(memoryStorage());
    const assembled = assembleBrowserSystemPrompt({ store, platform: "desktop" });
    expect(assembled.staticPrompt).toContain(assembled.platformOverlay);
    expect(assembled.systemPrompt).toContain("[TEMPORAL_CONTEXT]");
    expect(assembled.chatMode).toBe("chat");
  });
});
