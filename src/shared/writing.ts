
export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  wordCount: number;
}

export interface Note extends NoteSummary {
  content: string;
  /**
   * Optional initial caret position to use immediately after creating a note.
   * Not persisted; only returned by create flows.
   */
  initialCursorOffset?: number;
}

export interface NoteEditProposalInput {
  selectedText: string;
  prompt: string;
  beforeText: string;
  afterText: string;
  documentText: string;
}

export interface NoteEditProposal {
  proposedText: string;
}

export interface NoteSpellCheckInput {
  selectedText: string;
  beforeText: string;
  afterText: string;
  documentText: string;
}

export interface NoteTemplateConfig {
  id: string;
  title: string;
  content: string;
}

/** Built-in template applied when creating a new note (New note / ⇧⌘N). */
export const DEFAULT_NOTE_TEMPLATE_ID = "blank";

export const DEFAULT_NOTE_TEMPLATES: NoteTemplateConfig[] = [
  {
    id: DEFAULT_NOTE_TEMPLATE_ID,
    title: "Blank",
    content: "# Note\n",
  },
  {
    id: "one-on-one",
    title: "1:1",
    content: [
      "# 1:1",
      "",
      "## Wins",
      "- ",
      "",
      "## Updates",
      "- ",
      "",
      "## Feedback",
      "- ",
      "",
      "## Blockers",
      "- ",
      "",
      "## Next steps",
      "- [ ] ",
    ].join("\n"),
  },
  {
    id: "daily-log",
    title: "Daily log",
    content: [
      "# Daily Log",
      "",
      "{{today}}",
      "",
      "## Wins",
      "- ",
      "",
      "## Focus",
      "- ",
      "",
      "## Blockers",
      "- ",
      "",
      "## Tomorrow",
      "- ",
    ].join("\n"),
  },
];

/** Inserted in template body; replaced with a locale-formatted date when a new note is created. */
export const NOTE_TEMPLATE_TODAY_TOKEN = "{{today}}";
/** Inserted in template body; removed at create-time and used as initial caret position. */
export const NOTE_TEMPLATE_CURSOR_TOKEN = "{{@cursor}}";

export function formatNoteTemplateToday(options?: {
  now?: Date;
  locales?: Intl.LocalesArgument;
  timeZone?: string;
}): string {
  const now = options?.now ?? new Date();
  return new Intl.DateTimeFormat(options?.locales, {
    dateStyle: "medium",
    ...(options?.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(now);
}

function interpolateNoteTemplateString(
  value: string,
  options?: {
    now?: Date;
    locales?: Intl.LocalesArgument;
    timeZone?: string;
  },
): string {
  if (!value.includes(NOTE_TEMPLATE_TODAY_TOKEN)) return value;
  const formatted = formatNoteTemplateToday(options);
  return value.split(NOTE_TEMPLATE_TODAY_TOKEN).join(formatted);
}

function stripTemplateCursorToken(content: string): { content: string; cursorOffset: number | null } {
  const cursorTokenPattern = /\{\{\s*@cursor\s*\}\}/g;
  let cursorOffset: number | null = null;
  let removedChars = 0;
  let next = "";
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = cursorTokenPattern.exec(content)) != null) {
    const matchIndex = match.index;
    const rawToken = match[0];
    next += content.slice(lastIndex, matchIndex);
    if (cursorOffset == null) {
      cursorOffset = matchIndex - removedChars;
    }
    removedChars += rawToken.length;
    lastIndex = matchIndex + rawToken.length;
  }
  if (lastIndex === 0) {
    return { content, cursorOffset: null };
  }
  next += content.slice(lastIndex);
  return { content: next, cursorOffset };
}

export function resolveNoteTemplateContent(
  content: string,
  options?: {
    now?: Date;
    locales?: Intl.LocalesArgument;
    timeZone?: string;
  },
): { content: string; cursorOffset: number | null } {
  const interpolated = interpolateNoteTemplateString(content, options);
  return stripTemplateCursorToken(interpolated);
}


/** Resolves template variables in a note template title at creation time. */
export function interpolateNoteTemplateTitle(
  title: string,
  options?: {
    now?: Date;
    locales?: Intl.LocalesArgument;
    timeZone?: string;
  },
): string {
  return interpolateNoteTemplateString(title, options);
}

export function normalizeNoteTemplates(input: unknown): NoteTemplateConfig[] {
  if (!Array.isArray(input) || input.length !== DEFAULT_NOTE_TEMPLATES.length) {
    return DEFAULT_NOTE_TEMPLATES.map((t) => ({ ...t }));
  }
  const byId = new Map(
    input
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const candidate = item as Record<string, unknown>;
        const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
        const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
        const content = typeof candidate.content === "string" ? candidate.content : "";
        if (!id || !title) return null;
        return { id, title, content };
      })
      .filter((entry): entry is NoteTemplateConfig => entry != null)
      .map((entry) => [entry.id, entry]),
  );
  return DEFAULT_NOTE_TEMPLATES.map((base) => {
    const match = byId.get(base.id);
    return match ? { ...match } : { ...base };
  });
}

/** Resolves a stored default-template id against the available templates. */
export function normalizeDefaultNoteTemplateId(
  input: unknown,
  templates: readonly NoteTemplateConfig[] = DEFAULT_NOTE_TEMPLATES,
): string {
  const id = typeof input === "string" ? input.trim() : "";
  if (id && templates.some((template) => template.id === id)) return id;
  if (templates.some((template) => template.id === DEFAULT_NOTE_TEMPLATE_ID)) {
    return DEFAULT_NOTE_TEMPLATE_ID;
  }
  return templates[0]?.id ?? DEFAULT_NOTE_TEMPLATE_ID;
}

/** Resolves the template used for newly created notes (defaults to Blank). */
export function getDefaultNoteTemplate(
  templates: readonly NoteTemplateConfig[] = DEFAULT_NOTE_TEMPLATES,
  defaultTemplateId: unknown = DEFAULT_NOTE_TEMPLATE_ID,
): NoteTemplateConfig {
  const id = normalizeDefaultNoteTemplateId(defaultTemplateId, templates);
  const match = templates.find((template) => template.id === id);
  if (match) return { ...match };
  const fallback = DEFAULT_NOTE_TEMPLATES.find((template) => template.id === DEFAULT_NOTE_TEMPLATE_ID);
  return fallback ? { ...fallback } : { ...DEFAULT_NOTE_TEMPLATES[0] };
}

export const UNTITLED_NOTE_TITLE = "Untitled";

/**
 * Derives a note title from an ATX H1 on the first non-empty line; otherwise uses fallback.
 * Does not infer titles from plain text or lower-level headings.
 */
export function titleFromMarkdownContent(content: string, fallback: string): string {
  const firstLine = content
    .split("\n")
    .map((line) => line.trimEnd())
    .find((line) => line.trim().length > 0);
  if (!firstLine) return fallback;
  const parsed = parseMarkdownHeadingLine(firstLine);
  if (!parsed || parsed.level !== 1) return fallback;
  const headingText = firstLine.slice(parsed.markerLength).trim();
  if (!headingText) return fallback;
  return headingText.length > 80 ? `${headingText.slice(0, 80).trimEnd()}...` : headingText;
}

/**
 * Removes a leading markdown heading marker from note title text.
 * Examples: "# Note" -> "Note", "##Todo" -> "Todo".
 */
export function stripLeadingMarkdownHeading(text: string): string {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/^\s{0,3}#{1,6}\s*/, "").trim();
}

/** Display label for a note title: strips a leading markdown heading marker, falls back to the raw title. */
export function getDisplayNoteTitle(title: string): string {
  const stripped = stripLeadingMarkdownHeading(title);
  return stripped || title;
}

export interface ParsedMarkdownHeadingLine {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Character length of leading indent + `#` markers + required trailing space. */
  markerLength: number;
}

/** Parses ATX markdown heading lines (`# Title`). Requires whitespace after `#` markers. */
export function parseMarkdownHeadingLine(line: string): ParsedMarkdownHeadingLine | null {
  const match = line.match(/^(\s{0,3})(#{1,6})\s+(.*)$/);
  if (!match) return null;
  const [, indent, hashes] = match;
  const level = hashes.length;
  if (level < 1 || level > 6) return null;
  return {
    level: level as ParsedMarkdownHeadingLine["level"],
    markerLength: indent.length + hashes.length + 1,
  };
}

/**
 * Returns the markdown list prefix to continue on the next line, if the given
 * line looks like a non-empty bullet/numbered list item.
 */
export function getListContinuationPrefixForLine(line: string): string | null {
  const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
  if (unorderedMatch) {
    const [, indent, bullet, content] = unorderedMatch;
    if (content.trim()) {
      return `${indent}${bullet} `;
    }
  }

  const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
  if (orderedMatch) {
    const [, indent, rawNumber, content] = orderedMatch;
    if (content.trim()) {
      const nextNumber = Number.parseInt(rawNumber, 10) + 1;
      return `${indent}${nextNumber}. `;
    }
  }

  return null;
}

/**
 * Returns leading spaces for a soft line break inside a list item so wrapped
 * or Shift+Enter continuation lines align under the item text, not the marker.
 */
export function getListSoftBreakPrefixForLine(line: string): string | null {
  const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (unorderedMatch) {
    const [, indent, bullet, content] = unorderedMatch;
    if (content.trim()) {
      return `${indent}${" ".repeat(bullet.length + 1)}`;
    }
  }

  const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (orderedMatch) {
    const [, indent, rawNumber, content] = orderedMatch;
    if (content.trim()) {
      return `${indent}${" ".repeat(`${rawNumber}. `.length)}`;
    }
  }

  return null;
}

export const LIST_ITEM_INDENT_SPACES = 4;

const MARKDOWN_LIST_ITEM_LINE_RE = /^(\s*)(?:[-*+]\s|\d+\.\s)/;

/** True when the line starts with a markdown bullet or numbered list marker. */
export function isMarkdownListItemLine(line: string): boolean {
  return MARKDOWN_LIST_ITEM_LINE_RE.test(line);
}

/** Indents or outdents list-item lines in a block by four spaces per level. */
export function adjustMarkdownListItemIndent(
  block: string,
  direction: "indent" | "outdent",
): { block: string; deltaAtStart: number; deltaTotal: number; changed: boolean } {
  const lines = block.split("\n");
  let deltaAtStart = 0;
  let deltaTotal = 0;
  let changed = false;

  const newLines = lines.map((line, index) => {
    if (!isMarkdownListItemLine(line)) return line;

    if (direction === "indent") {
      changed = true;
      deltaTotal += LIST_ITEM_INDENT_SPACES;
      if (index === 0) deltaAtStart = LIST_ITEM_INDENT_SPACES;
      return `${" ".repeat(LIST_ITEM_INDENT_SPACES)}${line}`;
    }

    const leadingSpaces = line.match(/^(\s+)/)?.[1]?.length ?? 0;
    if (leadingSpaces === 0) return line;

    const removeCount = Math.min(LIST_ITEM_INDENT_SPACES, leadingSpaces);
    changed = true;
    deltaTotal += removeCount;
    if (index === 0) deltaAtStart = removeCount;
    return line.slice(removeCount);
  });

  return {
    block: newLines.join("\n"),
    deltaAtStart,
    deltaTotal,
    changed,
  };
}

export interface ParsedMarkdownListItemLine {
  headPrefix: string;
  softPrefix: string;
  content: string;
}

/** Splits a markdown list item line into marker prefixes and body text. */
export function parseMarkdownListItemLine(line: string): ParsedMarkdownListItemLine | null {
  const unorderedMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (unorderedMatch) {
    const [, indent, bullet, content] = unorderedMatch;
    const headPrefix = `${indent}${bullet} `;
    return {
      headPrefix,
      softPrefix: `${indent}${" ".repeat(bullet.length + 1)}`,
      content,
    };
  }

  const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (orderedMatch) {
    const [, indent, rawNumber, content] = orderedMatch;
    const headPrefix = `${indent}${rawNumber}. `;
    return {
      headPrefix,
      softPrefix: `${indent}${" ".repeat(`${rawNumber}. `.length)}`,
      content,
    };
  }

  return null;
}

export function findListItemHeadForLine(lines: string[], lineIndex: number): ParsedMarkdownListItemLine | null {
  for (let index = lineIndex; index >= 0; index -= 1) {
    const parsed = parseMarkdownListItemLine(lines[index] ?? "");
    if (parsed) return parsed;
    const line = lines[index] ?? "";
    if (!line.trim()) return null;
    if (!/^\s/.test(line)) return null;
  }
  return null;
}

export function isListItemContinuationLine(lines: string[], lineIndex: number): boolean {
  if (lineIndex <= 0) return false;
  const line = lines[lineIndex] ?? "";
  if (!line.trim() || isMarkdownListItemLine(line)) return false;
  const head = findListItemHeadForLine(lines, lineIndex);
  if (!head) return false;
  return line.startsWith(head.softPrefix) || /^\s+/.test(line);
}
