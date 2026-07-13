import { describe, expect, it } from "vitest";
import {
  NOTE_TEMPLATE_CURSOR_TOKEN,
  NOTE_TEMPLATE_TODAY_TOKEN,
  adjustMarkdownListItemIndent,
  getListContinuationPrefixForLine,
  getListSoftBreakPrefixForLine,
  isMarkdownListItemLine,
  DEFAULT_NOTE_TEMPLATE_ID,
  getDefaultNoteTemplate,
  interpolateNoteTemplateTitle,
  normalizeDefaultNoteTemplateId,
  normalizeNoteTemplates,
  parseMarkdownHeadingLine,
  resolveNoteTemplateContent,
  stripLeadingMarkdownHeading,
  titleFromMarkdownContent,
} from "./writing";

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

describe("normalizeNoteTemplates", () => {
  it("includes today token in default daily-log template content", () => {
    const templates = normalizeNoteTemplates(undefined);
    const daily = templates.find((t) => t.id === "daily-log");
    expect(daily?.content).toContain(NOTE_TEMPLATE_TODAY_TOKEN);
  });

  it("drops legacy description fields", () => {
    const base = normalizeNoteTemplates(undefined);
    const templates = normalizeNoteTemplates(
      base.map((t) => (t.id === "blank" ? { ...t, description: "Empty" } : t)),
    );
    expect(templates.find((t) => t.id === "blank")).toEqual({
      id: "blank",
      title: "Blank",
      content: "# Note\n",
    });
  });
});

describe("getDefaultNoteTemplate", () => {
  it("returns the blank template by id", () => {
    const template = getDefaultNoteTemplate();
    expect(template.id).toBe(DEFAULT_NOTE_TEMPLATE_ID);
    expect(template.content).toBe("# Note\n");
  });

  it("uses the configured blank template when settings override content", () => {
    const base = normalizeNoteTemplates(undefined);
    const templates = base.map((t) =>
      t.id === DEFAULT_NOTE_TEMPLATE_ID ? { ...t, content: "# Custom\n" } : t,
    );
    expect(getDefaultNoteTemplate(templates).content).toBe("# Custom\n");
  });

  it("honors a non-blank default template id", () => {
    const templates = normalizeNoteTemplates(undefined);
    const daily = getDefaultNoteTemplate(templates, "daily-log");
    expect(daily.id).toBe("daily-log");
  });
});

describe("normalizeDefaultNoteTemplateId", () => {
  it("falls back to blank for unknown ids", () => {
    expect(normalizeDefaultNoteTemplateId("missing")).toBe(DEFAULT_NOTE_TEMPLATE_ID);
  });

  it("keeps a valid template id", () => {
    expect(normalizeDefaultNoteTemplateId("one-on-one")).toBe("one-on-one");
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

describe("titleFromMarkdownContent", () => {
  it("uses only a leading H1 as the title", () => {
    expect(titleFromMarkdownContent("# Roadmap\n\nNext", "Untitled")).toBe("Roadmap");
    expect(titleFromMarkdownContent("## Section\nBody", "Untitled")).toBe("Untitled");
    expect(titleFromMarkdownContent("Plain text", "Untitled")).toBe("Untitled");
  });

  it("falls back when the first non-empty line is blank or missing", () => {
    expect(titleFromMarkdownContent("\n\n", "Untitled")).toBe("Untitled");
  });
});
