import { describe, expect, it } from "vitest";
import {
  flushStreamingMarkdown,
  hasUnbalancedInlineMarkers,
  hasVisibleStreamingBlocks,
  isClosedFenceBlock,
  splitStreamingMarkdown,
} from "./streamingMarkdownBlocks";

describe("splitStreamingMarkdown", () => {
  it("returns empty for empty input", () => {
    expect(splitStreamingMarkdown("")).toEqual({ completed: [], trailing: "" });
  });

  it("keeps incomplete prose in trailing", () => {
    expect(splitStreamingMarkdown("Hello world")).toEqual({
      completed: [],
      trailing: "Hello world",
    });
  });

  it("commits on blank-line paragraph boundaries", () => {
    expect(splitStreamingMarkdown("Para one\n\nPara two")).toEqual({
      completed: ["Para one\n\n"],
      trailing: "Para two",
    });
  });

  it("keeps open fence blocks in trailing", () => {
    const sample = "Intro\n\n```swift\nlet x = 1\n";
    const blocks = splitStreamingMarkdown(sample);
    expect(blocks.completed).toEqual(["Intro\n\n"]);
    expect(blocks.trailing).toBe("```swift\nlet x = 1\n");
    expect(isClosedFenceBlock(blocks.trailing)).toBe(false);
  });

  it("commits closed fence blocks", () => {
    const sample = "Intro\n\n```swift\nlet x = 1\n```";
    const blocks = splitStreamingMarkdown(sample);
    expect(blocks.completed.join("") + blocks.trailing).toBe(sample);
    expect(blocks.trailing).toBe("");
    expect(isClosedFenceBlock(blocks.completed[blocks.completed.length - 1]!)).toBe(true);
  });

  it("preserves content on round-trip", () => {
    const samples = [
      "Hello **wor",
      "Hello **wor\n\nNext",
      "Para one\n\nPara two\n\nPara three",
      "Intro\n\n```\ncode\n```\n\nOutro",
    ];
    for (const sample of samples) {
      const blocks = splitStreamingMarkdown(sample);
      expect(blocks.completed.join("") + blocks.trailing).toBe(sample);
    }
  });

  it("incrementally grows without reshaping settled blocks", () => {
    const steps = ["Para one", "Para one\n\n", "Para one\n\nPara two"];
    let previous = splitStreamingMarkdown("");
    for (const step of steps) {
      previous = splitStreamingMarkdown(step, previous);
      const full = splitStreamingMarkdown(step);
      expect(previous.completed.join("") + previous.trailing).toBe(step);
      expect(previous.completed).toEqual(full.completed);
      expect(previous.trailing).toBe(full.trailing);
    }
  });

  it("reuses the previous completed array when only trailing grows", () => {
    const first = splitStreamingMarkdown("Para one\n\nPara");
    expect(first.completed).toEqual(["Para one\n\n"]);

    const grown = splitStreamingMarkdown("Para one\n\nPara two", first);
    expect(grown.completed).toBe(first.completed);
    expect(grown.trailing).toBe("Para two");
  });

  it("returns the previous blocks unchanged when content did not change", () => {
    const first = splitStreamingMarkdown("Para one\n\nPara two");
    expect(splitStreamingMarkdown("Para one\n\nPara two", first)).toBe(first);
  });

  it("allocates a new completed array when a block settles", () => {
    const first = splitStreamingMarkdown("Para one\n\nPara two");
    const settled = splitStreamingMarkdown("Para one\n\nPara two\n\nPara three", first);
    expect(settled.completed).not.toBe(first.completed);
    expect(settled.completed).toEqual(["Para one\n\n", "Para two\n\n"]);
    expect(settled.trailing).toBe("Para three");
  });

  it("flushStreamingMarkdown appends trailing", () => {
    const blocks = splitStreamingMarkdown("Hello world");
    expect(flushStreamingMarkdown(blocks)).toEqual({
      completed: ["Hello world"],
      trailing: "",
    });
  });
});

describe("hasVisibleStreamingBlocks", () => {
  it("is false for empty content", () => {
    expect(hasVisibleStreamingBlocks("", true)).toBe(false);
    expect(hasVisibleStreamingBlocks("", false)).toBe(false);
  });

  it("is false while streaming with trailing-only prose", () => {
    expect(hasVisibleStreamingBlocks("Hello world", true)).toBe(false);
  });

  it("is true after a blank-line commit while streaming", () => {
    expect(hasVisibleStreamingBlocks("Para one\n\nPara two", true)).toBe(true);
  });

  it("is true after flush when not streaming", () => {
    expect(hasVisibleStreamingBlocks("Hello world", false)).toBe(true);
  });
});

describe("hasUnbalancedInlineMarkers", () => {
  it("detects unclosed bold", () => {
    expect(hasUnbalancedInlineMarkers("Hello **wor")).toBe(true);
    expect(hasUnbalancedInlineMarkers("Hello **world**")).toBe(false);
  });
});
