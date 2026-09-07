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
    expect(gaps.map((g) => g.kind)).toEqual(["openai_api_key", "sync_r2", "macos_accessibility"]);
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

  it("still reports API key and sync gaps on the browser client", () => {
    const gaps = collectSetupGaps({
      hasOpenAIApiKey: false,
      syncConfigured: false,
      platform: "linux",
    });
    expect(gaps.map((g) => g.kind)).toEqual(["openai_api_key", "sync_r2"]);
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

  it("shows while a required gap remains", () => {
    expect(shouldShowSetupNotice(requiredGap, true)).toBe(true);
    expect(shouldShowSetupNotice(requiredGap, false)).toBe(true);
  });

  it("does not interrupt for recommended-only gaps", () => {
    expect(shouldShowSetupNotice(recommendedOnlyGaps, true)).toBe(false);
    expect(shouldShowSetupNotice(recommendedOnlyGaps, false)).toBe(false);
  });
});

describe("DEFAULT_SETTINGS", () => {
  it("does not embed secrets in defaults", () => {
    expect(DEFAULT_SETTINGS.openai?.apiKey).toBe("");
    expect(DEFAULT_SETTINGS.search?.tavilyApiKey).toBe("");
    expect(DEFAULT_SETTINGS.sync?.prefix).toBe("harness/");
  });
});
