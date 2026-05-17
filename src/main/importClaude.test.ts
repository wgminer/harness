import { describe, expect, it } from "vitest";
import { parseClaudeConversation, parseClaudeFile } from "./importClaude";

describe("importClaude parsing", () => {
  it("maps sender labels to internal roles", () => {
    const parsed = parseClaudeConversation({
      uuid: "c1",
      name: "Test thread",
      created_at: "2024-05-01T12:00:00Z",
      chat_messages: [
        { sender: "human", text: "hi there" },
        { sender: "assistant", text: "hello!" },
        { sender: "tool", text: "ignored" },
      ],
    });
    expect(parsed?.id).toBe("c1");
    expect(parsed?.title).toBe("Test thread");
    expect(parsed?.messages).toEqual([
      { role: "user", content: "hi there" },
      { role: "assistant", content: "hello!" },
    ]);
  });

  it("prefers structured content blocks over the flat text field", () => {
    const parsed = parseClaudeConversation({
      uuid: "c2",
      chat_messages: [
        {
          sender: "human",
          text: "fallback only",
          content: [
            { type: "text", text: "structured first" },
            { type: "tool_use", name: "noop" },
            { type: "text", text: "structured second" },
          ],
        },
      ],
    });
    expect(parsed?.messages).toEqual([
      { role: "user", content: "structured first\nstructured second" },
    ]);
  });

  it("falls back to flat text when content blocks have no text", () => {
    const parsed = parseClaudeConversation({
      uuid: "c3",
      chat_messages: [
        { sender: "assistant", text: "plain", content: [{ type: "tool_use" }] },
      ],
    });
    expect(parsed?.messages).toEqual([{ role: "assistant", content: "plain" }]);
  });

  it("skips messages without text content", () => {
    const parsed = parseClaudeConversation({
      uuid: "c4",
      chat_messages: [
        { sender: "human", content: [] },
        { sender: "assistant", text: "" },
        { sender: "human", text: "  " },
        { sender: "assistant", text: "kept" },
      ],
    });
    expect(parsed?.messages).toEqual([{ role: "assistant", content: "kept" }]);
  });

  it("returns null when uuid is missing", () => {
    expect(parseClaudeConversation({ name: "x", chat_messages: [] })).toBeNull();
    expect(parseClaudeConversation(null)).toBeNull();
    expect(parseClaudeConversation("not an object")).toBeNull();
  });

  it("uses created_at for createdAt when parseable, defaults otherwise", () => {
    const parsed = parseClaudeConversation({
      uuid: "c5",
      name: "T",
      created_at: "2024-01-02T03:04:05Z",
      chat_messages: [],
    });
    expect(parsed?.createdAt).toBe(Date.UTC(2024, 0, 2, 3, 4, 5));

    const fallback = parseClaudeConversation({
      uuid: "c6",
      name: "T",
      chat_messages: [],
    });
    expect(typeof fallback?.createdAt).toBe("number");
    expect(fallback?.createdAt).toBeGreaterThan(0);
  });

  it("parses file arrays and tolerates invalid json", () => {
    const rows = parseClaudeFile(
      JSON.stringify([
        { uuid: "a", name: "A", chat_messages: [] },
        { uuid: "b", name: "B", chat_messages: [] },
      ])
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(parseClaudeFile("{not-json")).toEqual([]);
  });
});
