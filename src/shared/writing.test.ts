import { describe, expect, it } from "vitest";
import {
  NOTE_TEMPLATE_CURSOR_TOKEN,
  NOTE_TEMPLATE_TODAY_TOKEN,
  adjustMarkdownListItemIndent,
  getListContinuationPrefixForLine,
  isMarkdownListItemLine,
  interpolateNoteTemplateContent,
  interpolateNoteTemplateTitle,
  normalizeNoteTemplateDescription,
  normalizeNoteTemplates,
  resolveNoteTemplateContent,
  stripLeadingMarkdownHeading,
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

  it("removes cursor token from the stored content", () => {
    expect(interpolateNoteTemplateContent(`# Note\n\n${NOTE_TEMPLATE_CURSOR_TOKEN}`, fixed)).toBe("# Note\n\n");
  });
});

describe("resolveNoteTemplateContent", () => {
  const fixed = {
    now: new Date("2026-05-05T00:00:00.000Z"),
    locales: "en-US" as const,
    timeZone: "UTC",
  };

  it("returns cursor offset at the first marker position", () => {
    const resolved = resolveNoteTemplateContent("Hello {{@cursor}}world {{@cursor}}again", fixed);
    expect(resolved.content).toBe("Hello world again");
    expect(resolved.cursorOffset).toBe(6);
  });

  it("supports optional whitespace inside the cursor token", () => {
    const resolved = resolveNoteTemplateContent("A{{ @cursor }}B", fixed);
    expect(resolved.content).toBe("AB");
    expect(resolved.cursorOffset).toBe(1);
  });

  it("leaves unsupported cursor token variants unchanged", () => {
    const resolved = resolveNoteTemplateContent("A{{ ::cursor:: }}B", fixed);
    expect(resolved.content).toBe("A{{ ::cursor:: }}B");
    expect(resolved.cursorOffset).toBeNull();
  });

  it("returns null cursor offset when no marker is present", () => {
    const resolved = resolveNoteTemplateContent("No cursor marker here", fixed);
    expect(resolved.content).toBe("No cursor marker here");
    expect(resolved.cursorOffset).toBeNull();
  });
});

describe("interpolateNoteTemplateTitle", () => {
  it("replaces today tokens in title templates", () => {
    expect(
      interpolateNoteTemplateTitle("Daily log — {{today}}", {
        now: new Date("2026-05-05T00:00:00.000Z"),
        locales: "en-US",
        timeZone: "UTC",
      }),
    ).toBe("Daily log — May 5, 2026");
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

describe("isMarkdownListItemLine", () => {
  it("matches unordered and ordered list markers", () => {
    expect(isMarkdownListItemLine("- item")).toBe(true);
    expect(isMarkdownListItemLine("- ")).toBe(true);
    expect(isMarkdownListItemLine("    - nested")).toBe(true);
    expect(isMarkdownListItemLine("1. first")).toBe(true);
    expect(isMarkdownListItemLine("plain text")).toBe(false);
  });
});

describe("adjustMarkdownListItemIndent", () => {
  it("indents list lines by four spaces", () => {
    expect(adjustMarkdownListItemIndent("- item", "indent")).toEqual({
      block: "    - item",
      deltaAtStart: 4,
      deltaTotal: 4,
      changed: true,
    });
  });

  it("outdents list lines by up to four spaces", () => {
    expect(adjustMarkdownListItemIndent("    - item", "outdent")).toEqual({
      block: "- item",
      deltaAtStart: 4,
      deltaTotal: 4,
      changed: true,
    });
    expect(adjustMarkdownListItemIndent("- item", "outdent")).toEqual({
      block: "- item",
      deltaAtStart: 0,
      deltaTotal: 0,
      changed: false,
    });
  });

  it("indents each list line in a multi-line block", () => {
    expect(adjustMarkdownListItemIndent("- one\n- two", "indent")).toEqual({
      block: "    - one\n    - two",
      deltaAtStart: 4,
      deltaTotal: 8,
      changed: true,
    });
  });
});

describe("stripLeadingMarkdownHeading", () => {
  it("removes a leading heading marker", () => {
    expect(stripLeadingMarkdownHeading("# Weekly notes")).toBe("Weekly notes");
    expect(stripLeadingMarkdownHeading("###   Tasks")).toBe("Tasks");
  });

  it("returns non-heading text unchanged", () => {
    expect(stripLeadingMarkdownHeading("Meeting notes")).toBe("Meeting notes");
  });
});
