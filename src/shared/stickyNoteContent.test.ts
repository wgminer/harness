import { describe, expect, it } from "vitest";
import { joinNoteTitleAndBody, splitNoteTitleAndBody } from "./writing";

describe("splitNoteTitleAndBody", () => {
  it("splits a leading h1 from the body", () => {
    expect(splitNoteTitleAndBody("# Title\n\nBody line")).toEqual({
      title: "Title",
      body: "Body line",
    });
  });

  it("returns full content as body when no h1 heading", () => {
    expect(splitNoteTitleAndBody("Plain text")).toEqual({
      title: "",
      body: "Plain text",
    });
  });
});

describe("joinNoteTitleAndBody", () => {
  it("merges title and body into markdown", () => {
    expect(joinNoteTitleAndBody("Title", "Body line")).toBe("# Title\n\nBody line");
  });

  it("defaults missing title to Untitled", () => {
    expect(joinNoteTitleAndBody("", "")).toBe("# Untitled\n");
  });
});
