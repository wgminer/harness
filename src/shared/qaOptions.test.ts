import { describe, expect, it } from "vitest";
import { parseQaOptions, qaChoiceRevealPlan, stripQaOptions } from "./qaOptions";

const SAMPLE = [
  "What's the real constraint?",
  "",
  "::::options",
  ':::option{title="Calendar — already booked"}',
  ":::",
  ':::option{title="Risk — too many unknowns"}',
  ":::",
  ':::option{title="Energy — you\'re fried"}',
  ":::",
  "::::",
].join("\n");

describe("parseQaOptions", () => {
  it("extracts titles from a four-colon options fence", () => {
    expect(parseQaOptions(SAMPLE)).toEqual([
      "Calendar — already booked",
      "Risk — too many unknowns",
      "Energy — you're fried",
    ]);
  });

  it("returns empty when fewer than two options", () => {
    const one = [
      "::::options",
      ':::option{title="Only one"}',
      ":::",
      "::::",
    ].join("\n");
    expect(parseQaOptions(one)).toEqual([]);
    expect(parseQaOptions("plain prose")).toEqual([]);
  });

  it("clamps to four options", () => {
    const many = [
      "::::options",
      ':::option{title="A"}',
      ":::",
      ':::option{title="B"}',
      ":::",
      ':::option{title="C"}',
      ":::",
      ':::option{title="D"}',
      ":::",
      ':::option{title="E"}',
      ":::",
      "::::",
    ].join("\n");
    expect(parseQaOptions(many)).toEqual(["A", "B", "C", "D"]);
  });
});

describe("stripQaOptions", () => {
  it("removes the fence and leaves the question prose", () => {
    const stripped = stripQaOptions(SAMPLE);
    expect(stripped).toBe("What's the real constraint?");
    expect(stripped).not.toContain("::::options");
    expect(stripped).not.toContain(":::option");
    expect(stripped).not.toContain("Calendar");
  });

  it("strips leftover option lines without an outer fence", () => {
    const orphan = 'Hello\n:::option{title="Redis"}\n:::\n';
    expect(stripQaOptions(orphan).trim()).toBe("Hello");
  });
});

describe("qaChoiceRevealPlan", () => {
  it("holds the chooser only after a Q&A turn finishes", () => {
    expect(
      qaChoiceRevealPlan({
        justFinishedTurn: true,
        modeIsQa: true,
        prefersReducedMotion: false,
      }),
    ).toBe("hold");
  });

  it("shows immediately when opening a thread, leaving Q&A, or reducing motion", () => {
    expect(
      qaChoiceRevealPlan({
        justFinishedTurn: false,
        modeIsQa: true,
        prefersReducedMotion: false,
      }),
    ).toBe("immediate");
    expect(
      qaChoiceRevealPlan({
        justFinishedTurn: true,
        modeIsQa: false,
        prefersReducedMotion: false,
      }),
    ).toBe("immediate");
    expect(
      qaChoiceRevealPlan({
        justFinishedTurn: true,
        modeIsQa: true,
        prefersReducedMotion: true,
      }),
    ).toBe("immediate");
  });
});
