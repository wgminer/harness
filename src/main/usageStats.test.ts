import { describe, expect, it, afterEach } from "vitest";
import {
  buildOpenAIThisMonthSnapshot,
  extractCachedPromptTokens,
  migrateLegacyOpenAITotals,
  parseUsageStatsPersisted,
  persistedToSnapshot,
  resetUsageStatsNowProvider,
  setUsageStatsNowProvider,
} from "./usageStats";

describe("extractCachedPromptTokens", () => {
  it("reads cached_tokens from prompt_tokens_details", () => {
    expect(
      extractCachedPromptTokens({
        prompt_tokens: 1000,
        completion_tokens: 0,
        total_tokens: 1000,
        prompt_tokens_details: { cached_tokens: 400 },
      } as never)
    ).toBe(400);
  });

  it("returns 0 when details missing", () => {
    expect(
      extractCachedPromptTokens({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      } as never)
    ).toBe(0);
  });
});

describe("migrateLegacyOpenAITotals", () => {
  it("folds v1 openai totals into current month under unknown", () => {
    const at = new Date("2026-05-10T00:00:00Z");
    const migrated = migrateLegacyOpenAITotals(
      {
        openai: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
        parakeet: { modelTokens: 0, words: 10, transcriptions: 1 },
        updatedAt: 1,
      },
      "2026-05"
    );
    expect(migrated.openaiByMonth["2026-05"]?.unknown).toEqual({
      promptTokens: 1000,
      cachedPromptTokens: 0,
      completionTokens: 500,
    });
    expect(migrated.parakeet.words).toBe(10);
  });
});

describe("parseUsageStatsPersisted", () => {
  it("parses v2 monthly buckets", () => {
    const at = new Date("2026-05-10T00:00:00Z");
    const p = parseUsageStatsPersisted(
      {
        version: 2,
        openaiByMonth: {
          "2026-05": {
            "gpt-5.4": { promptTokens: 100, cachedPromptTokens: 10, completionTokens: 50 },
          },
        },
        parakeet: { modelTokens: 0, words: 0, transcriptions: 0 },
        updatedAt: 2,
      },
      at
    );
    expect(p.openaiByMonth["2026-05"]?.["gpt-5.4"]?.promptTokens).toBe(100);
  });
});

describe("buildOpenAIThisMonthSnapshot", () => {
  it("sums tokens and estimates cost for current month", () => {
    const at = new Date("2026-05-15T12:00:00Z");
    const snap = buildOpenAIThisMonthSnapshot(
      {
        version: 2,
        openaiByMonth: {
          "2026-05": {
            "gpt-5.4-nano": { promptTokens: 1_000_000, cachedPromptTokens: 0, completionTokens: 0 },
          },
          "2026-04": {
            "gpt-5.4": { promptTokens: 9_999_999, cachedPromptTokens: 0, completionTokens: 0 },
          },
        },
        parakeet: { modelTokens: 0, words: 0, transcriptions: 0 },
        updatedAt: 0,
      },
      at
    );
    expect(snap.monthKey).toBe("2026-05");
    expect(snap.promptTokens).toBe(1_000_000);
    expect(snap.estimatedUsd).toBeCloseTo(0.2, 6);
  });

  it("returns zero for a month with no usage", () => {
    const at = new Date("2026-06-01T00:00:00Z");
    const snap = buildOpenAIThisMonthSnapshot(
      {
        version: 2,
        openaiByMonth: { "2026-05": { "gpt-5.4": { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 0 } } },
        parakeet: { modelTokens: 0, words: 0, transcriptions: 0 },
        updatedAt: 0,
      },
      at
    );
    expect(snap.monthKey).toBe("2026-06");
    expect(snap.estimatedUsd).toBe(0);
  });
});

describe("persistedToSnapshot", () => {
  it("includes all-time openai totals across months", () => {
    const snap = persistedToSnapshot(
      {
        version: 2,
        openaiByMonth: {
          "2026-04": { "gpt-5.4": { promptTokens: 100, cachedPromptTokens: 0, completionTokens: 0 } },
          "2026-05": { "gpt-5.4": { promptTokens: 200, cachedPromptTokens: 0, completionTokens: 0 } },
        },
        parakeet: { modelTokens: 0, words: 0, transcriptions: 0 },
        updatedAt: 0,
      },
      new Date("2026-05-10T00:00:00Z")
    );
    expect(snap.openai.promptTokens).toBe(300);
    expect(snap.openaiThisMonth.promptTokens).toBe(200);
  });
});

describe("month rollover via nowProvider", () => {
  afterEach(() => {
    resetUsageStatsNowProvider();
  });

  it("uses nowProvider for openaiThisMonth month key", () => {
    setUsageStatsNowProvider(() => new Date("2026-06-01T00:00:00Z"));
    const snap = persistedToSnapshot(
      {
        version: 2,
        openaiByMonth: {
          "2026-05": { "gpt-5.4": { promptTokens: 999, cachedPromptTokens: 0, completionTokens: 0 } },
          "2026-06": { "gpt-5.4": { promptTokens: 1, cachedPromptTokens: 0, completionTokens: 0 } },
        },
        parakeet: { modelTokens: 0, words: 0, transcriptions: 0 },
        updatedAt: 0,
      },
      new Date("2026-06-01T00:00:00Z")
    );
    expect(snap.openaiThisMonth.monthKey).toBe("2026-06");
    expect(snap.openaiThisMonth.promptTokens).toBe(1);
  });
});
