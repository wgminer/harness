import { describe, expect, it } from "vitest";
import { formatMemoryContextBlock, sortedMemoryEntries } from "./memoryInjection";

describe("sortedMemoryEntries", () => {
  const memory = {
    alpha: "first",
    beta: "second",
    writing_style: "concise professional tone",
    zip: "12528",
  };

  it("returns every entry sorted by key", () => {
    expect(sortedMemoryEntries(memory)).toEqual([
      ["alpha", "first"],
      ["beta", "second"],
      ["writing_style", "concise professional tone"],
      ["zip", "12528"],
    ]);
  });

  it("skips blank keys", () => {
    expect(sortedMemoryEntries({ "": "ignored", tone: "warm" })).toEqual([["tone", "warm"]]);
  });
});

describe("formatMemoryContextBlock", () => {
  it("wraps facts with memory context markers", () => {
    const block = formatMemoryContextBlock([["tone", "concise"]]);
    expect(block).toContain("[USER_MEMORY_CONTEXT]");
    expect(block).toContain("- tone: concise");
    expect(block).toContain("[MEMORY_RULES]");
  });

  it("returns empty string when no facts", () => {
    expect(formatMemoryContextBlock([])).toBe("");
  });
});
