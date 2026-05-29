import { describe, expect, it } from "vitest";
import {
  estimateModelCostUsd,
  estimateMonthCostUsd,
  utcMonthKey,
  utcMonthLabel,
} from "./openaiPricing";

describe("estimateModelCostUsd", () => {
  it("charges uncached prompt and completion at list rates for gpt-5.4", () => {
    const cost = estimateModelCostUsd("gpt-5.4", {
      promptTokens: 1_000_000,
      cachedPromptTokens: 0,
      completionTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(2.5 + 15, 6);
  });

  it("uses cached input rate for cached tokens", () => {
    const cost = estimateModelCostUsd("gpt-5.4-mini", {
      promptTokens: 1_000_000,
      cachedPromptTokens: 500_000,
      completionTokens: 0,
    });
    expect(cost).toBeCloseTo(0.5 * 0.75 + 0.5 * 0.075, 6);
  });

  it("clamps cached tokens to prompt total", () => {
    const cost = estimateModelCostUsd("gpt-5.4-nano", {
      promptTokens: 100,
      cachedPromptTokens: 999,
      completionTokens: 0,
    });
    expect(cost).toBeCloseTo((100 / 1_000_000) * 0.02, 8);
  });

  it("falls back to gpt-5.4 rates for unknown models", () => {
    const known = estimateModelCostUsd("gpt-5.4", {
      promptTokens: 10_000,
      cachedPromptTokens: 0,
      completionTokens: 10_000,
    });
    const unknown = estimateModelCostUsd("some-future-model", {
      promptTokens: 10_000,
      cachedPromptTokens: 0,
      completionTokens: 10_000,
    });
    expect(unknown).toBe(known);
  });
});

describe("estimateMonthCostUsd", () => {
  it("sums across models", () => {
    const total = estimateMonthCostUsd({
      "gpt-5.4-nano": { promptTokens: 1_000_000, cachedPromptTokens: 0, completionTokens: 0 },
      "gpt-5.4": { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 1_000_000 },
    });
    expect(total).toBeCloseTo(0.2 + 15, 6);
  });
});

describe("utcMonthKey", () => {
  it("formats UTC month", () => {
    expect(utcMonthKey(new Date("2026-05-15T12:00:00Z"))).toBe("2026-05");
    expect(utcMonthKey(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01");
  });
});

describe("utcMonthLabel", () => {
  it("formats readable label", () => {
    expect(utcMonthLabel("2026-05")).toBe("May 2026 (UTC)");
  });
});
