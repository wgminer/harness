import { describe, expect, it } from "vitest";
import { createBrowserStore, generateBrowserId, memoryStorage, mergeSettings } from "./browserStore";
import { DEFAULT_SETTINGS } from "../../shared/types";

describe("generateBrowserId", () => {
  it("matches the desktop conv_timestamp_hex shape", () => {
    expect(generateBrowserId("conv", 1700000000000, () => 0xabc / 0xffffffff)).toBe(
      "conv_1700000000000_00000abc",
    );
  });
});

describe("mergeSettings", () => {
  it("keeps nested defaults when a partial section is saved", () => {
    const next = mergeSettings(DEFAULT_SETTINGS, {
      appearance: { accent: "#ff0000" },
    });
    expect(next.appearance?.accent).toBe("#ff0000");
    expect(next.chat?.openToComposeOnLaunch).toBe(true);
  });
});

describe("createBrowserStore", () => {
  it("persists conversations, messages, and sidebar visibility flags", () => {
    const store = createBrowserStore(memoryStorage());
    const id = store.createConversation("decide");
    expect(store.conversation(id)?.chatMode).toBe("decide");
    expect(store.conversation(id)?.hasMessages).toBe(false);

    store.appendMessage(id, "user", "Hello there", { timestamp: 1 });
    store.appendMessage(id, "assistant", "Hi", { timestamp: 2, model: "gpt-5.4" });

    const conv = store.conversation(id);
    expect(conv?.hasMessages).toBe(true);
    expect(conv?.hasAssistantReply).toBe(true);
    expect(conv?.messages).toHaveLength(2);
    expect(store.popLastUserMessage(id)).toBe("Hello there");
    expect(store.conversation(id)?.messages).toHaveLength(1);
  });

  it("round-trips through the injected storage", () => {
    const storage = memoryStorage();
    const first = createBrowserStore(storage);
    first.setSecret("openaiApiKey", "sk-test");
    const id = first.createConversation();
    first.appendMessage(id, "user", "persist me");

    const second = createBrowserStore(storage);
    expect(second.secrets().openaiApiKey).toBe("sk-test");
    expect(second.conversation(id)?.messages[0]?.content).toBe("persist me");
  });
});
