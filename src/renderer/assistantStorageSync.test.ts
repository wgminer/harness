import { describe, expect, it } from "vitest";
import {
  mergeAssistantFromStorage,
  noteStaleStreamEndExpected,
  consumeStaleStreamEnd,
} from "./assistantStorageSync";

describe("mergeAssistantFromStorage", () => {
  it("does not replace a shorter streamed reply with a longer previous assistant", () => {
    const merged = mergeAssistantFromStorage(
      { content: "Done.", toolCalls: [{ toolName: "list_directory", payload: {} }] },
      { content: "Here is a long previous answer about something else entirely." }
    );
    expect(merged).toBeNull();
  });

  it("fills empty local content from storage after append", () => {
    const merged = mergeAssistantFromStorage(
      { content: "" },
      { content: "Final reply", model: "gpt-test" }
    );
    expect(merged).toEqual({
      content: "Final reply",
      toolCalls: undefined,
      model: "gpt-test",
    });
  });

  it("syncs tool calls when note metadata arrives in storage", () => {
    const merged = mergeAssistantFromStorage(
      {
        content: "Summary",
        toolCalls: [
          {
            toolName: "note_create",
            payload: { attachedToMessage: true, summary: "Summary", note: { title: "Doc" } },
          },
        ],
      },
      {
        content: "Summary",
        toolCalls: [
          {
            toolName: "note_create",
            payload: {
              attachedToMessage: true,
              summary: "Summary",
              note: { id: "note-1", title: "Doc" },
            },
          },
        ],
      }
    );
    expect(merged?.toolCalls?.[0]?.payload).toMatchObject({
      note: { id: "note-1" },
    });
    expect(merged?.content).toBe("Summary");
  });

  it("returns null when nothing needs syncing", () => {
    expect(
      mergeAssistantFromStorage(
        { content: "Hello", model: "m" },
        { content: "Hello", model: "m" }
      )
    ).toBeNull();
  });
});

describe("stale stream end tracking", () => {
  it("ignores the next stream end after superseding an in-flight turn", () => {
    let pending = 0;
    pending = noteStaleStreamEndExpected(pending);
    const first = consumeStaleStreamEnd(pending);
    expect(first.ignore).toBe(true);
    pending = first.pending;
    const second = consumeStaleStreamEnd(pending);
    expect(second.ignore).toBe(false);
  });
});
