export interface NoteSummary {
  id: string;
  title: string;
  updatedAt: number;
  createdAt: number;
  wordCount: number;
}

export interface Note extends NoteSummary {
  content: string;
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
  if (!content.includes(NOTE_TEMPLATE_TODAY_TOKEN)) return content;
  const formatted = formatNoteTemplateToday(options);
  return content.split(NOTE_TEMPLATE_TODAY_TOKEN).join(formatted);
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
        const description = typeof candidate.description === "string" ? candidate.description.trim() : "";
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
