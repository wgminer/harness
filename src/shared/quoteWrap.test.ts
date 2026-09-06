import { describe, expect, it } from "vitest";
import { HOME_HEADER_QUOTES } from "./headerQuote";
import { NEW_CHAT_QUOTE_MAX_LINE_CHARS, balanceQuoteWrap } from "./quoteWrap";

describe("balanceQuoteWrap", () => {
  it("leaves a short line alone", () => {
    expect(balanceQuoteWrap("Live the questions now.")).toBe("Live the questions now.");
  });

  it("splits a two-line quote evenly instead of orphaning the last word", () => {
    expect(balanceQuoteWrap("What I cannot create, I do not understand.", 36)).toBe(
      "What I cannot create,\nI do not understand.",
    );
  });

  it("prefers a sentence boundary when that is the even split", () => {
    expect(
      balanceQuoteWrap(
        "The impediment to action advances action. What stands in the way becomes the way.",
        46,
      ),
    ).toBe("The impediment to action advances action.\nWhat stands in the way becomes the way.");
  });

  it("collapses extra whitespace", () => {
    expect(balanceQuoteWrap("  Good   prose is like a windowpane.  ")).toBe(
      "Good prose is like a windowpane.",
    );
  });

  it("returns empty for blank input", () => {
    expect(balanceQuoteWrap("   ")).toBe("");
  });

  it("wraps every home header quote without orphans or leftover re-wrap", () => {
    for (const quote of HOME_HEADER_QUOTES) {
      const displayed = `“${quote.full}”`;
      const wrapped = balanceQuoteWrap(displayed);
      const lines = wrapped.split("\n");
      expect(lines.join(" ")).toBe(displayed);
      expect(lines.every((line) => line.length > 0)).toBe(true);
      expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
        Math.max(NEW_CHAT_QUOTE_MAX_LINE_CHARS, ...displayed.split(/\s+/).map((w) => w.length)),
      );
      if (lines.length > 1) {
        const longest = Math.max(...lines.map((line) => line.length));
        const shortest = Math.min(...lines.map((line) => line.length));
        expect(shortest / longest).toBeGreaterThanOrEqual(0.55);
      }
    }
  });
});
