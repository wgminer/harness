import { describe, expect, it } from "vitest";
import { countWords, formatWordCount } from "./wordCount";

describe("countWords", () => {
  it("returns 0 for empty or whitespace", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   ")).toBe(0);
  });

  it("counts whitespace-separated tokens", () => {
    expect(countWords("one")).toBe(1);
    expect(countWords("one two three")).toBe(3);
    expect(countWords("  leading trailing  ")).toBe(2);
  });
});

describe("formatWordCount", () => {
  it("singular and plural", () => {
    expect(formatWordCount(1)).toBe("1 word");
    expect(formatWordCount(0)).toBe("0 words");
    expect(formatWordCount(2)).toBe("2 words");
  });
});
