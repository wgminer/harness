import { describe, expect, it } from "vitest";
import {
  NOTE_TEMPLATE_TODAY_TOKEN,
  getListContinuationPrefixForLine,
  interpolateNoteTemplateContent,
  normalizeNoteTemplateDescription,
  normalizeNoteTemplates,
} from "./writing";

describe("interpolateNoteTemplateContent", () => {
  const fixed = {
    now: new Date("2026-05-05T00:00:00.000Z"),
    locales: "en-US" as const,
    timeZone: "UTC",
  };

  it("replaces a single token with the formatted date", () => {
    expect(interpolateNoteTemplateContent(`Log for ${NOTE_TEMPLATE_TODAY_TOKEN}`, fixed)).toBe(
      "Log for May 5, 2026",
    );
  });

  it("replaces every occurrence", () => {
    expect(
      interpolateNoteTemplateContent(
        `${NOTE_TEMPLATE_TODAY_TOKEN} — ${NOTE_TEMPLATE_TODAY_TOKEN}`,
        fixed,
      ),
    ).toBe("May 5, 2026 — May 5, 2026");
  });

  it("leaves other brace text unchanged", () => {
    expect(interpolateNoteTemplateContent("{{tomorrow}} and {{user}}", fixed)).toBe("{{tomorrow}} and {{user}}");
  });

  it("returns the same string when the token is absent", () => {
    const body = "# Note\n\nNo variables here.\n";
    expect(interpolateNoteTemplateContent(body, fixed)).toBe(body);
  });
});

describe("normalizeNoteTemplateDescription", () => {
  it("keeps a single line unchanged", () => {
    expect(normalizeNoteTemplateDescription("  Reflective  ")).toBe("Reflective");
  });

  it("drops text after the first newline", () => {
    expect(normalizeNoteTemplateDescription("First line\nSecond line")).toBe("First line");
  });
});

describe("normalizeNoteTemplates", () => {
  it("includes today token in default daily-log template content", () => {
    const templates = normalizeNoteTemplates(undefined);
    const daily = templates.find((t) => t.id === "daily-log");
    expect(daily?.content).toContain(NOTE_TEMPLATE_TODAY_TOKEN);
  });

  it("truncates multi-line descriptions to one line", () => {
    const base = normalizeNoteTemplates(undefined);
    const templates = normalizeNoteTemplates(
      base.map((t) =>
        t.id === "blank" ? { ...t, description: "Line one\nLine two" } : t,
      ),
    );
    expect(templates.find((t) => t.id === "blank")?.description).toBe("Line one");
  });
});

describe("getListContinuationPrefixForLine", () => {
  it("continues unordered list items", () => {
    expect(getListContinuationPrefixForLine("- item")).toBe("- ");
    expect(getListContinuationPrefixForLine("  - nested item")).toBe("  - ");
  });

  it("continues numbered list items with incremented index", () => {
    expect(getListContinuationPrefixForLine("1. first")).toBe("2. ");
    expect(getListContinuationPrefixForLine("  9. nested")).toBe("  10. ");
  });

  it("does not continue blank or non-list lines", () => {
    expect(getListContinuationPrefixForLine("- ")).toBeNull();
    expect(getListContinuationPrefixForLine("plain text")).toBeNull();
  });
});
