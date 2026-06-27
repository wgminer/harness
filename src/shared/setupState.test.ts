import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types";
import { collectSetupGaps, hasOpenAIApiKey, openAIRequiredMessage } from "./setupState";

describe("hasOpenAIApiKey", () => {
  it("returns false for empty or whitespace keys", () => {
    expect(hasOpenAIApiKey({ openai: { apiKey: "" } })).toBe(false);
    expect(hasOpenAIApiKey({ openai: { apiKey: "   " } })).toBe(false);
    expect(hasOpenAIApiKey({})).toBe(false);
  });

  it("returns true when a key is present", () => {
    expect(hasOpenAIApiKey({ openai: { apiKey: "sk-test" } })).toBe(true);
  });
});

describe("collectSetupGaps", () => {
  it("reports missing API key and backup folder on a fresh install", () => {
    const gaps = collectSetupGaps({
      settings: DEFAULT_SETTINGS,
      syncConfigured: false,
      platform: "darwin",
      accessibilityTrusted: false,
    });
    expect(gaps.map((g) => g.kind)).toEqual([
      "openai_api_key",
      "backup_folder",
      "macos_accessibility",
    ]);
  });

  it("returns no gaps when everything is configured", () => {
    const gaps = collectSetupGaps({
      settings: { ...DEFAULT_SETTINGS, openai: { apiKey: "sk-test" } },
      syncConfigured: true,
      platform: "darwin",
      accessibilityTrusted: true,
    });
    expect(gaps).toEqual([]);
  });
});

describe("openAIRequiredMessage", () => {
  it("points users to System → General", () => {
    expect(openAIRequiredMessage()).toContain("System → General");
  });
});
