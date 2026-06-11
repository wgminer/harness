/** Title for the numbered-list note that replaces legacy clippings. */
export const CLIPPINGS_NOTE_TITLE = "Clippings";

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

export interface NoteTemplateConfig {
  id: string;
  title: string;
  description: string;
  content: string;
}

export const DEFAULT_NOTE_TEMPLATES: NoteTemplateConfig[] = [
  {
    id: "blank",
    title: "Blank",
    description: "Empty",
    content: "# Note\n",
  },
  {
    id: "one-on-one",
    title: "1:1",
    description: "Sync",
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
    description: "Reflective",
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

/** Collapse stored template descriptions to a single trimmed line. */
export function normalizeNoteTemplateDescription(raw: string): string {
  const firstLine = raw.trim().split(/\r?\n/, 1)[0] ?? "";
  return firstLine.trim();
}

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

/**
 * Resolves template variables in note template content at creation time.
 * Unknown tokens are left unchanged.
 */
export function interpolateNoteTemplateContent(
  content: string,
  options?: {
    now?: Date;
    locales?: Intl.LocalesArgument;
    timeZone?: string;
  },
): string {
  return resolveNoteTemplateContent(content, options).content;
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
        const description =
          typeof candidate.description === "string"
            ? normalizeNoteTemplateDescription(candidate.description)
            : "";
        const content = typeof candidate.content === "string" ? candidate.content : "";
        if (!id || !title || !description) return null;
        return { id, title, description, content };
      })
      .filter((entry): entry is NoteTemplateConfig => entry != null)
      .map((entry) => [entry.id, entry]),
  );
  return DEFAULT_NOTE_TEMPLATES.map((base) => {
    const match = byId.get(base.id);
    return match ? { ...match } : { ...base };
  });
}

export const UNTITLED_NOTE_TITLE = "Untitled note";

/**
 * Removes a leading markdown heading marker from note title text.
 * Examples: "# Note" -> "Note", "##Todo" -> "Todo".
 */
export function stripLeadingMarkdownHeading(text: string): string {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return "";
  return trimmed.replace(/^\s{0,3}#{1,6}\s*/, "").trim();
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
