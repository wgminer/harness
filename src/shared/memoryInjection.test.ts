import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEMORY_INJECTION_STRATEGY,
  parseMemoryInjectionStrategy,
  selectMemoryEntriesForPrompt,
} from "./memoryInjection";

describe("parseMemoryInjectionStrategy", () => {
  it("defaults unknown values to all", () => {
    expect(parseMemoryInjectionStrategy("bogus")).toBe(DEFAULT_MEMORY_INJECTION_STRATEGY);
    expect(parseMemoryInjectionStrategy(undefined)).toBe("all");
  });
});

describe("selectMemoryEntriesForPrompt", () => {
  const memory = {
    alpha: "first",
    beta: "second",
    writing_style: "concise professional tone",
    zip: "12528",
  };

  it("none returns empty", () => {
    expect(selectMemoryEntriesForPrompt("none", memory, "hello")).toEqual([]);
  });

  it("all returns every entry sorted by key", () => {
    expect(selectMemoryEntriesForPrompt("all", memory)).toEqual([
      ["alpha", "first"],
      ["beta", "second"],
      ["writing_style", "concise professional tone"],
      ["zip", "12528"],
    ]);
  });

  it("relevant prefers overlapping facts", () => {
    const selected = selectMemoryEntriesForPrompt("relevant", memory, "help me with tone and style");
    expect(selected.some(([k]) => k === "writing_style")).toBe(true);
    expect(selected.some(([k]) => k === "zip")).toBe(false);
  });

  it("budget caps total characters", () => {
    const big: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      big[`fact_${String(i).padStart(2, "0")}`] = "x".repeat(80);
    }
    const selected = selectMemoryEntriesForPrompt("budget", big);
    const chars = selected.reduce((n, [k, v]) => n + `- ${k}: ${v}`.length, 0);
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.length).toBeLessThan(40);
    expect(chars).toBeLessThanOrEqual(900);
  });
});
