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

export interface NoteSpellCheckInput {
  selectedText: string;
  beforeText: string;
  afterText: string;
  documentText: string;
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

function wrapListItemTextToLines(
  text: string,
  headPrefix: string,
  softPrefix: string,
  maxContentWidthPx: number,
  measureLine: (line: string) => number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [headPrefix.trimEnd() ? headPrefix : text];
  }

  const lines: string[] = [];
  let chunk: string[] = [];

  const currentPrefix = () => (lines.length === 0 ? headPrefix : softPrefix);

  const flush = () => {
    if (chunk.length === 0) return;
    lines.push(`${currentPrefix()}${chunk.join(" ")}`);
    chunk = [];
  };

  for (const word of words) {
    const candidate = chunk.length ? `${chunk.join(" ")} ${word}` : word;
    const measured = measureLine(`${currentPrefix()}${candidate}`);
    if (measured <= maxContentWidthPx || chunk.length === 0) {
      chunk.push(word);
      continue;
    }
    flush();
    chunk = [word];
  }

  flush();
  return lines;
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

function remapSelectionForWrappedLines(
  lineStart: number,
  oldLine: string,
  oldPrefix: string,
  newLines: string[],
  newPrefixes: string[],
  selection: number,
): number {
  const oldLineEnd = lineStart + oldLine.length;
  if (selection <= lineStart) return selection;
  if (selection >= oldLineEnd) {
    return selection + (newLines.join("\n").length - oldLine.length);
  }

  const contentOffset = Math.max(0, Math.min(selection - lineStart - oldPrefix.length, oldLine.length - oldPrefix.length));
  let remaining = contentOffset;
  let pos = lineStart;

  for (let index = 0; index < newLines.length; index += 1) {
    const prefix = newPrefixes[index] ?? "";
    const content = newLines[index]?.slice(prefix.length) ?? "";
    if (remaining <= content.length) {
      return pos + prefix.length + remaining;
    }
    remaining -= content.length;
    pos += (newLines[index]?.length ?? 0) + 1;
  }

  return lineStart + newLines.join("\n").length;
}

/**
 * Hard-wraps overflowing markdown list lines using soft-break indentation so
 * wrapped rows align under list item text in a monospace textarea.
 */
export function reflowMarkdownListWrapInDraft(
  draft: string,
  selection: number,
  maxContentWidthPx: number,
  measureLine: (line: string) => number,
): { draft: string; selection: number } {
  if (maxContentWidthPx <= 0 || !draft) {
    return { draft, selection };
  }

  const lines = draft.split("\n");
  let nextSelection = selection;
  let lineStart = 0;
  let changed = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";

    const parsedListItem = parseMarkdownListItemLine(line);
    const continuationHead = parsedListItem ? null : findListItemHeadForLine(lines, index);
    const isContinuation = !parsedListItem && isListItemContinuationLine(lines, index);

    let wrapped: string[] | null = null;
    let oldPrefix = "";
    let newPrefixes: string[] = [];

    if (parsedListItem && measureLine(line) > maxContentWidthPx) {
      wrapped = wrapListItemTextToLines(
        parsedListItem.content,
        parsedListItem.headPrefix,
        parsedListItem.softPrefix,
        maxContentWidthPx,
        measureLine,
      );
      oldPrefix = parsedListItem.headPrefix;
      newPrefixes = wrapped.map((_, wrappedIndex) =>
        wrappedIndex === 0 ? parsedListItem.headPrefix : parsedListItem.softPrefix,
      );
    } else if (isContinuation && continuationHead && measureLine(line) > maxContentWidthPx) {
      const content = line.startsWith(continuationHead.softPrefix)
        ? line.slice(continuationHead.softPrefix.length)
        : line.trimStart();
      wrapped = wrapListItemTextToLines(
        content,
        continuationHead.softPrefix,
        continuationHead.softPrefix,
        maxContentWidthPx,
        measureLine,
      );
      oldPrefix = line.startsWith(continuationHead.softPrefix)
        ? continuationHead.softPrefix
        : line.slice(0, line.length - line.trimStart().length);
      newPrefixes = wrapped.map(() => continuationHead.softPrefix);
    }

    if (wrapped && wrapped.join("\n") !== line) {
      changed = true;
      nextSelection = remapSelectionForWrappedLines(lineStart, line, oldPrefix, wrapped, newPrefixes, nextSelection);
      lines.splice(index, 1, ...wrapped);
      lineStart += wrapped.join("\n").length + 1;
      index += wrapped.length - 1;
      continue;
    }

    lineStart += line.length + 1;
  }

  if (!changed) {
    return { draft, selection };
  }

  return { draft: lines.join("\n"), selection: nextSelection };
}
