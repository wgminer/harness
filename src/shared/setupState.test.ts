import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./types";
import { collectSetupGaps, shouldShowSetupNotice } from "./setupState";

describe("collectSetupGaps", () => {
  it("reports missing API key and R2 sync on a fresh install", () => {
    const gaps = collectSetupGaps({
      hasOpenAIApiKey: false,
      syncConfigured: false,
      platform: "darwin",
      accessibilityTrusted: false,
    });
    expect(gaps.map((g) => g.kind)).toEqual([
      "openai_api_key",
      "sync_r2",
      "macos_accessibility",
    ]);
  });

  it("returns no gaps when everything is configured", () => {
    const gaps = collectSetupGaps({
      hasOpenAIApiKey: true,
      syncConfigured: true,
      platform: "darwin",
      accessibilityTrusted: true,
    });
    expect(gaps).toEqual([]);
  });
});

describe("shouldShowSetupNotice", () => {
  const requiredGap = collectSetupGaps({
    hasOpenAIApiKey: false,
    syncConfigured: true,
    platform: "darwin",
    accessibilityTrusted: true,
  });
  const recommendedOnlyGaps = collectSetupGaps({
    hasOpenAIApiKey: true,
    syncConfigured: false,
    platform: "darwin",
    accessibilityTrusted: true,
  });

  it("shows again after dismiss when a required gap remains", () => {
    expect(shouldShowSetupNotice(requiredGap, true)).toBe(true);
  });

  it("respects dismiss when only recommended gaps remain", () => {
    expect(shouldShowSetupNotice(recommendedOnlyGaps, true)).toBe(false);
    expect(shouldShowSetupNotice(recommendedOnlyGaps, false)).toBe(true);
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("does not embed secrets in defaults", () => {
    expect(DEFAULT_SETTINGS.openai?.apiKey).toBe("");
    expect(DEFAULT_SETTINGS.search?.tavilyApiKey).toBe("");
    expect(DEFAULT_SETTINGS.sync?.prefix).toBe("harness/");
  });
});
