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
