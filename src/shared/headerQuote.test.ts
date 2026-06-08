import { describe, expect, it } from "vitest";
import {
  formatForHeader,
  headerQuote,
  numberedListItems,
  stripInlineTags,
} from "./headerQuote";

describe("headerQuote", () => {
  it("uses numbered list lines from note content", () => {
    const content = "1. From my notes.\n2. Custom clipping quote.\n";
    expect(headerQuote(content, 0)).toBe("From my notes.");
  });

  it("returns empty when no numbered lines", () => {
    expect(headerQuote("Plain paragraph.", 0)).toBe("");
  });

  it("returns empty when note is empty", () => {
    expect(headerQuote("", 0)).toBe("");
  });

  it("normalizes whitespace in line content", () => {
    expect(formatForHeader("  Line one.\n\n  Line two.  ")).toBe("Line one. Line two.");
  });

  it("strips inline tags for header display", () => {
    const content = "1. Waste no more time arguing. #quotes #stoicism";
    expect(headerQuote(content, 0)).toBe("Waste no more time arguing.");
  });

  it("uses rotation index across lines", () => {
    const content = "1. One\n2. Two\n";
    expect(headerQuote(content, 0)).toBe("One");
    expect(headerQuote(content, 1)).toBe("Two");
  });

  it("parses numbered list items", () => {
    expect(numberedListItems("1. First\nplain\n2. Second")).toEqual(["First", "Second"]);
  });

  it("strips inline tags", () => {
    expect(stripInlineTags("Hello #tag world")).toBe("Hello world");
  });
});
