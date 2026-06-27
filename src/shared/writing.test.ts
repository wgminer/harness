import { describe, expect, it } from "vitest";
import {
  NOTE_TEMPLATE_CURSOR_TOKEN,
  NOTE_TEMPLATE_TODAY_TOKEN,
  adjustMarkdownListItemIndent,
  getListContinuationPrefixForLine,
  getListSoftBreakPrefixForLine,
  isMarkdownListItemLine,
  interpolateNoteTemplateContent,
  interpolateNoteTemplateTitle,
  normalizeNoteTemplateDescription,
  normalizeNoteTemplates,
  parseMarkdownHeadingLine,
  reflowMarkdownListWrapInDraft,
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

describe("getListSoftBreakPrefixForLine", () => {
  it("indents soft breaks under unordered list text", () => {
    expect(getListSoftBreakPrefixForLine("- item")).toBe("  ");
    expect(getListSoftBreakPrefixForLine("  - nested item")).toBe("    ");
  });

  it("indents soft breaks under ordered list text", () => {
    expect(getListSoftBreakPrefixForLine("1. first")).toBe("   ");
    expect(getListSoftBreakPrefixForLine("  10. nested")).toBe("      ");
  });

  it("does not soft-break blank or non-list lines", () => {
    expect(getListSoftBreakPrefixForLine("- ")).toBeNull();
    expect(getListSoftBreakPrefixForLine("plain text")).toBeNull();
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

describe("reflowMarkdownListWrapInDraft", () => {
  const charWidth = 8;
  const measureLine = (line: string) => line.length * charWidth;

  it("wraps overflowing unordered list items with soft-break indentation", () => {
    const draft = "- alpha beta gamma delta epsilon zeta eta theta iota";
    const maxWidth = 24 * charWidth;
    const { draft: reflowed } = reflowMarkdownListWrapInDraft(draft, draft.length, maxWidth, measureLine);
    expect(reflowed).toContain("\n  ");
    expect(reflowed.split("\n").every((line) => measureLine(line) <= maxWidth || line.trim() === "")).toBe(true);
  });

  it("wraps overflowing continuation lines under the list marker", () => {
    const draft = "- short\n  alpha beta gamma delta epsilon zeta eta theta iota kappa";
    const maxWidth = 24 * charWidth;
    const { draft: reflowed } = reflowMarkdownListWrapInDraft(draft, draft.length, maxWidth, measureLine);
    expect(reflowed.split("\n").length).toBeGreaterThan(2);
    expect(reflowed.split("\n").slice(1).every((line) => line.startsWith("  "))).toBe(true);
  });

  it("wraps overflowing nested unordered list items", () => {
    const draft =
      "  - The core need is that it must become much simpler and more coherent to get an app into Slack or to get an agent into Slack.";
    const maxWidth = 48 * charWidth;
    const { draft: reflowed } = reflowMarkdownListWrapInDraft(draft, draft.length, maxWidth, measureLine);
    expect(reflowed.split("\n").length).toBeGreaterThan(1);
    expect(reflowed.split("\n").slice(1).every((line) => line.startsWith("    "))).toBe(true);
  });

  it("leaves short list items unchanged", () => {
    const draft = "- fits on one line";
    const { draft: reflowed } = reflowMarkdownListWrapInDraft(draft, draft.length, 80 * charWidth, measureLine);
    expect(reflowed).toBe(draft);
  });
});

describe("parseMarkdownHeadingLine", () => {
  it("parses ATX headings with required marker spacing", () => {
    expect(parseMarkdownHeadingLine("# Title")).toEqual({ level: 1, markerLength: 2 });
    expect(parseMarkdownHeadingLine("## Subtitle")).toEqual({ level: 2, markerLength: 3 });
    expect(parseMarkdownHeadingLine("   ### Indented")).toEqual({ level: 3, markerLength: 7 });
  });

  it("rejects lines without marker spacing or non-headings", () => {
    expect(parseMarkdownHeadingLine("#NoSpace")).toBeNull();
    expect(parseMarkdownHeadingLine("- list item")).toBeNull();
    expect(parseMarkdownHeadingLine("plain text")).toBeNull();
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
