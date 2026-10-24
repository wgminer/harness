import { describe, expect, it } from "vitest";
import type { LlmTiming } from "../../shared/desktopAPI";
import { formatSeconds, summarizeChatTimings } from "./llmTimingSummary";

function timing(partial: Partial<LlmTiming>): LlmTiming {
  return {
    startedAt: 0,
    kind: "chat",
    model: "m",
    totalMs: 1000,
    outcome: "ok",
    ...partial,
  };
}

describe("summarizeChatTimings", () => {
  it("returns null without successful chat rounds", () => {
    expect(summarizeChatTimings([])).toBeNull();
    expect(summarizeChatTimings([timing({ outcome: "error" }), timing({ kind: "title" })])).toBeNull();
  });

  it("reports medians of ok chat rounds only", () => {
    const summary = summarizeChatTimings([
      timing({ totalMs: 2000, firstTokenMs: 500 }),
      timing({ totalMs: 4000, firstTokenMs: 1500 }),
      timing({ totalMs: 90_000, outcome: "error" }),
      timing({ kind: "image", totalMs: 30_000 }),
    ]);
    expect(summary).toBe("Chat median over 2 rounds: first token 1.0s, total 3.0s.");
  });
});

describe("formatSeconds", () => {
  it("keeps a decimal under ten seconds", () => {
    expect(formatSeconds(1234)).toBe("1.2s");
    expect(formatSeconds(12_600)).toBe("13s");
  });
});
