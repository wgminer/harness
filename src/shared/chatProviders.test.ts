import { describe, expect, it } from "vitest";
import {
  CHAT_PROVIDERS,
  DEFAULT_CHAT_PROVIDER,
  DEFAULT_LOCAL_BASE_URL,
  normalizeChatProvider,
} from "./chatProviders";

describe("chatProviders contract", () => {
  it("lists OpenAI, Claude, and local with models", () => {
    expect(CHAT_PROVIDERS.map((p) => p.id)).toEqual(["openai", "claude", "local"]);
    for (const provider of CHAT_PROVIDERS) {
      expect(provider.chatModel.length).toBeGreaterThan(0);
      expect(provider.smallModel.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_LOCAL_BASE_URL).toBe("http://localhost:11434/v1");
  });

  it("falls back to the default provider", () => {
    expect(DEFAULT_CHAT_PROVIDER).toBe("openai");
    expect(normalizeChatProvider("claude")).toBe("claude");
    expect(normalizeChatProvider("gemini")).toBe("openai");
    expect(normalizeChatProvider(undefined)).toBe("openai");
  });
});
