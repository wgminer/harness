import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserChat } from "./browserChat";
import {
  BROWSER_DUMMY_MODEL,
  dummyAssistantReply,
  dummyReplyKind,
  streamDummyChat,
} from "./browserDummyChat";
import { onBrowserEvent, resetBrowserEvents } from "./browserEvents";
import { createBrowserStore, memoryStorage } from "./browserStore";

describe("dummyReplyKind", () => {
  it("picks the first trigger word and defaults to long", () => {
    expect(dummyReplyKind("hello playground")).toBe("long");
    expect(dummyReplyKind("short please")).toBe("short");
    expect(dummyReplyKind("Give me a LIST")).toBe("list");
    expect(dummyReplyKind("code then short")).toBe("code");
  });
});

describe("dummyAssistantReply", () => {
  it("echoes a clipped user line and names the dummy shell", () => {
    const reply = dummyAssistantReply("  hello playground  ");
    expect(reply).toContain("dummy reply");
    expect(reply).toContain("You wrote: hello playground");
  });

  it("uses the matching fixture for each trigger", () => {
    expect(dummyAssistantReply("short")).not.toContain("A few things worth watching");
    expect(dummyAssistantReply("list")).toContain("- Opening line replaces");
    expect(dummyAssistantReply("code")).toContain("```ts");
    expect(dummyAssistantReply("long")).toContain("A few things worth watching");
  });
});

describe("streamDummyChat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits, then emits chunks", async () => {
    vi.useFakeTimers();
    const chunks: string[] = [];
    const signal = new AbortController().signal;
    const done = streamDummyChat({
      text: "ABCD",
      signal,
      onChunk: (chunk) => chunks.push(chunk),
      thinkMs: 100,
      chunkChars: 2,
      chunkMs: 10,
    });
    expect(chunks).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(chunks).toEqual(["AB"]);
    await vi.advanceTimersByTimeAsync(10);
    expect(chunks).toEqual(["AB", "CD"]);
    await expect(done).resolves.toBe("ABCD");
  });

  it("rejects when aborted during the think delay", async () => {
    vi.useFakeTimers();
    const abort = new AbortController();
    const done = streamDummyChat({
      text: "nope",
      signal: abort.signal,
      onChunk: () => {},
      thinkMs: 500,
    });
    abort.abort();
    await expect(done).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("createBrowserChat dummy path", () => {
  afterEach(() => {
    vi.useRealTimers();
    resetBrowserEvents();
  });

  it("streams a dummy assistant reply when no API key is set", async () => {
    vi.useFakeTimers();
    const store = createBrowserStore(memoryStorage());
    const chat = createBrowserChat(store);
    const id = store.createConversation();
    const chunks: string[] = [];
    const unsub = onBrowserEvent<{ conversationId: string; chunk: string }>(
      "chat:streamChunk",
      (payload) => chunks.push(payload.chunk),
    );
    const done = chat.send(id, "Hello playground");
    await vi.runAllTimersAsync();
    await done;
    unsub();
    expect(chunks.join("")).toContain("dummy reply");
    const messages = store.conversation(id)?.messages ?? [];
    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.model).toBe(BROWSER_DUMMY_MODEL);
    expect(assistant?.content).toContain("You wrote: Hello playground");
  });
});
