import { afterEach, describe, expect, it } from "vitest";
import { createBrowserAdapter } from "./browserAdapter";
import { BROWSER_STORAGE_KEY, memoryStorage } from "./browserStore";

describe("createBrowserAdapter", () => {
  const original = globalThis.localStorage;

  afterEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: original,
    });
  });

  it("creates a conversation and lists it after a send-shaped append", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    });
    const api = createBrowserAdapter();
    expect(await api.env.isHarnessWeb()).toBe(true);
    const id = await api.memory.createConversation("write");
    await api.memory.appendMessage(id, "user", "Hello from the browser shell");
    const list = await api.memory.listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(id);
    expect(list[0].chatMode).toBe("write");
    expect(list[0].hasMessages).toBe(true);
    const messages = await api.memory.getMessages(id);
    expect(messages[0]?.content).toBe("Hello from the browser shell");
    expect(globalThis.localStorage.getItem(BROWSER_STORAGE_KEY)).toContain(id);
  });
});
