import { describe, expect, it } from "vitest";
import { parseUsageStatsPersisted } from "./usageStats";

describe("parseUsageStatsPersisted", () => {
  it("parses v3 parakeet counters", () => {
    const p = parseUsageStatsPersisted({
      version: 3,
      parakeet: { modelTokens: 10, words: 100, transcriptions: 2 },
      updatedAt: 2,
    });
    expect(p.parakeet.words).toBe(100);
    expect(p.version).toBe(3);
  });

  it("migrates legacy files by keeping parakeet counters only", () => {
    const p = parseUsageStatsPersisted({
      version: 2,
      openaiByMonth: {
        "2026-05": {
          "gpt-5.4": { promptTokens: 100, cachedPromptTokens: 10, completionTokens: 50 },
        },
      },
      parakeet: { modelTokens: 0, words: 10, transcriptions: 1 },
      updatedAt: 1,
    });
    expect(p.version).toBe(3);
    expect(p.parakeet.words).toBe(10);
  });

  it("migrates v1 openai totals without preserving them", () => {
    const p = parseUsageStatsPersisted({
      openai: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
      parakeet: { modelTokens: 0, words: 10, transcriptions: 1 },
      updatedAt: 1,
    });
    expect(p.version).toBe(3);
    expect(p.parakeet.transcriptions).toBe(1);
  });
});
