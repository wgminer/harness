import { describe, expect, it } from "vitest";
import { addSpelling } from "./SpellingTagInput";

describe("addSpelling", () => {
  it("appends a trimmed term", () => {
    expect(addSpelling(["Harness"], "  Claude Code ")).toEqual(["Harness", "Claude Code"]);
  });

  it("ignores empty input and case-insensitive duplicates", () => {
    expect(addSpelling(["Harness"], "   ")).toEqual(["Harness"]);
    expect(addSpelling(["Harness"], "harness")).toEqual(["Harness"]);
  });
});
