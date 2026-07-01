import { ipcMain, shell } from "electron";
import { randomUUID } from "crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import OpenAI from "openai";
import { OPENAI_CHAT_MODEL } from "../shared/openaiModels";
import {
  interpolateNoteTemplateTitle,
  resolveNoteTemplateContent,
  titleFromMarkdownContent,
  UNTITLED_NOTE_TITLE,
  type Note,
  type NoteEditProposal,
  type NoteEditProposalInput,
  type NoteSpellCheckInput,
  type NoteSummary,
} from "../shared/writing";
import { getMemoryDir } from "./memory";
import { getSettings, resolveOpenAIApiKey, resolveTavilyApiKey } from "./settings";
import { fileExists } from "./utils";

const LEGACY_DOC_FILE = "writing.md";
const NOTES_INDEX_FILE = "notes.json";
const NOTES_DIR = "notes";
const LEGACY_IMPORTED_NOTE_TITLE = "Imported note";

interface NotesIndexEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
}

interface NotesIndex {
  notes: NotesIndexEntry[];
}

function getLegacyDocPathIn(memoryDir: string): string {
  return join(memoryDir, LEGACY_DOC_FILE);
}

function getNotesIndexPathIn(memoryDir: string): string {
  return join(memoryDir, NOTES_INDEX_FILE);
}

function getNotesDirPathIn(memoryDir: string): string {
  return join(memoryDir, NOTES_DIR);
}

function getNotePathIn(memoryDir: string, id: string): string {
  return join(getNotesDirPathIn(memoryDir), `${id}.md`);
}

export function normalizeContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function normalizeTitle(title: string | undefined, fallback: string): string {
  const cleaned = String(title ?? "").trim().replace(/\s+/g, " ");
  return cleaned || fallback;
}

function countWords(content: string): number {
  const trimmed = String(content ?? "").trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function toSummary(entry: NotesIndexEntry): NoteSummary {
  return {
    id: entry.id,
    title: entry.title,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    wordCount: entry.wordCount,
  };
}

function sortByUpdatedAtDesc(entries: NotesIndexEntry[]): NotesIndexEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function ensureNotesDirIn(memoryDir: string): Promise<void> {
  await mkdir(getNotesDirPathIn(memoryDir), { recursive: true });
}

async function loadNotesIndexIn(memoryDir: string): Promise<NotesIndex> {
  const path = getNotesIndexPathIn(memoryDir);
  if (!(await fileExists(path))) {
    return { notes: [] };
  }
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as { notes?: unknown } | unknown[];
    const source = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.notes) ? parsed.notes : [];
    const notes = source
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const id = (item as { id?: unknown }).id;
        const title = (item as { title?: unknown }).title;
        const createdAt = (item as { createdAt?: unknown }).createdAt;
        const updatedAt = (item as { updatedAt?: unknown }).updatedAt;
        const wordCount = (item as { wordCount?: unknown }).wordCount;
        if (
          typeof id !== "string" ||
          typeof title !== "string" ||
          typeof createdAt !== "number" ||
          typeof updatedAt !== "number"
        ) {
          return null;
        }
        return {
          id,
          title,
          createdAt,
          updatedAt,
          wordCount: typeof wordCount === "number" && Number.isFinite(wordCount) ? Math.max(0, Math.floor(wordCount)) : 0,
        };
      })
      .filter((entry): entry is NotesIndexEntry => entry != null);
    return { notes: sortByUpdatedAtDesc(notes) };
  } catch {
    return { notes: [] };
  }
}

async function saveNotesIndexIn(memoryDir: string, index: NotesIndex): Promise<void> {
  const path = getNotesIndexPathIn(memoryDir);
  const sorted = sortByUpdatedAtDesc(index.notes);
  await writeFile(path, JSON.stringify({ notes: sorted }, null, 2), "utf-8");
}

async function migrateLegacyDocIn(memoryDir: string): Promise<void> {
  const index = await loadNotesIndexIn(memoryDir);
  if (index.notes.length > 0) return;

  const legacyPath = getLegacyDocPathIn(memoryDir);
  if (!(await fileExists(legacyPath))) return;

  const [content, info] = await Promise.all([readFile(legacyPath, "utf-8"), stat(legacyPath)]);
  const normalized = normalizeContent(content);
  const createdAt = info.mtimeMs || Date.now();
  const id = randomUUID();
  const notePath = getNotePathIn(memoryDir, id);

  await ensureNotesDirIn(memoryDir);
  await writeFile(notePath, normalized, "utf-8");
  await saveNotesIndexIn(memoryDir, {
    notes: [
      {
        id,
        title: titleFromMarkdownContent(normalized, LEGACY_IMPORTED_NOTE_TITLE),
        createdAt,
        updatedAt: createdAt,
        wordCount: countWords(normalized),
      },
    ],
  });
}

async function ensureNotesReadyIn(memoryDir: string): Promise<NotesIndex> {
  await ensureNotesDirIn(memoryDir);
  await migrateLegacyDocIn(memoryDir);
  return loadNotesIndexIn(memoryDir);
}

export async function listNotesIn(memoryDir: string): Promise<NoteSummary[]> {
  const index = await ensureNotesReadyIn(memoryDir);
  const notesWithWordCounts = await Promise.all(
    index.notes.map(async (entry) => {
      const path = getNotePathIn(memoryDir, entry.id);
      const content = (await fileExists(path)) ? await readFile(path, "utf-8") : "";
      return {
        ...entry,
        wordCount: countWords(content),
      };
    }),
  );
  const changed = notesWithWordCounts.some((entry, idx) => entry.wordCount !== index.notes[idx]?.wordCount);
  if (changed) {
    await saveNotesIndexIn(memoryDir, { notes: notesWithWordCounts });
  }
  return sortByUpdatedAtDesc(notesWithWordCounts).map(toSummary);
}

export async function listNotes(): Promise<NoteSummary[]> {
  return listNotesIn(getMemoryDir());
}

export async function createNoteIn(memoryDir: string, title?: string, content = ""): Promise<Note> {
  const index = await ensureNotesReadyIn(memoryDir);
  const id = randomUUID();
  const now = Date.now();
  const resolvedTemplate = resolveNoteTemplateContent(content);
  const normalizedContent = normalizeContent(resolvedTemplate.content);
  const interpolatedTitle = typeof title === "string" ? interpolateNoteTemplateTitle(title) : title;
  const fallbackTitle = normalizeTitle(interpolatedTitle, UNTITLED_NOTE_TITLE);
  const entry: NotesIndexEntry = {
    id,
    title: titleFromMarkdownContent(normalizedContent, fallbackTitle),
    createdAt: now,
    updatedAt: now,
    wordCount: countWords(normalizedContent),
  };
  await writeFile(getNotePathIn(memoryDir, id), normalizedContent, "utf-8");
  await saveNotesIndexIn(memoryDir, { notes: [entry, ...index.notes] });
  const normalizedCursorOffset =
    resolvedTemplate.cursorOffset == null
      ? undefined
      : normalizeContent(resolvedTemplate.content.slice(0, resolvedTemplate.cursorOffset)).length;
  return {
    ...entry,
    content: normalizedContent,
    initialCursorOffset:
      normalizedCursorOffset == null ? undefined : Math.max(0, Math.min(normalizedCursorOffset, normalizedContent.length)),
  };
}

export async function createNote(title?: string, content?: string): Promise<Note> {
  return createNoteIn(getMemoryDir(), title, content ?? "");
}

export async function readNoteIn(memoryDir: string, id: string): Promise<Note | null> {
  const cleanId = String(id ?? "").trim();
  if (!cleanId) return null;
  const index = await ensureNotesReadyIn(memoryDir);
  const entry = index.notes.find((item) => item.id === cleanId);
  if (!entry) return null;
  const notePath = getNotePathIn(memoryDir, cleanId);
  const content = (await fileExists(notePath)) ? await readFile(notePath, "utf-8") : "";
  return { ...entry, content };
}

export async function readNote(id: string): Promise<Note | null> {
  return readNoteIn(getMemoryDir(), id);
}

export async function saveNoteIn(memoryDir: string, id: string, content: string): Promise<Note> {
  const cleanId = String(id ?? "").trim();
  if (!cleanId) {
    throw new Error("saveNote requires a note id");
  }
  const index = await ensureNotesReadyIn(memoryDir);
  const noteIndex = index.notes.findIndex((item) => item.id === cleanId);
  if (noteIndex < 0) {
    throw new Error(`Note not found: ${cleanId}`);
  }
  const normalized = normalizeContent(content ?? "");
  await writeFile(getNotePathIn(memoryDir, cleanId), normalized, "utf-8");
  const now = Date.now();
  const current = index.notes[noteIndex];
  const updatedEntry: NotesIndexEntry = {
    ...current,
    title: titleFromMarkdownContent(normalized, current.title || UNTITLED_NOTE_TITLE),
    updatedAt: now,
    wordCount: countWords(normalized),
  };
  const next = [...index.notes];
  next[noteIndex] = updatedEntry;
  await saveNotesIndexIn(memoryDir, { notes: next });
  return { ...updatedEntry, content: normalized };
}

export async function saveNote(id: string, content: string): Promise<Note> {
  return saveNoteIn(getMemoryDir(), id, content);
}

export async function deleteNoteIn(memoryDir: string, id: string): Promise<NoteSummary[]> {
  const cleanId = String(id ?? "").trim();
  if (!cleanId) return listNotesIn(memoryDir);
  const index = await ensureNotesReadyIn(memoryDir);
  const next = index.notes.filter((item) => item.id !== cleanId);
  if (next.length === index.notes.length) return next.map(toSummary);
  const path = getNotePathIn(memoryDir, cleanId);
  if (await fileExists(path)) {
    await unlink(path).catch(() => undefined);
  }
  await saveNotesIndexIn(memoryDir, { notes: next });
  return sortByUpdatedAtDesc(next).map(toSummary);
}

export async function deleteNote(id: string): Promise<NoteSummary[]> {
  return deleteNoteIn(getMemoryDir(), id);
}

export async function showNoteInFolder(id: string): Promise<void> {
  const cleanId = String(id ?? "").trim();
  if (!cleanId) return;
  const notePath = getNotePathIn(getMemoryDir(), cleanId);
  if (!(await fileExists(notePath))) {
    throw new Error(`Note file not found: ${cleanId}`);
  }
  shell.showItemInFolder(notePath);
}

export async function executeNoteTool(
  name: "note_list" | "note_create" | "note_read" | "note_save" | "note_delete",
  args: Record<string, unknown>,
): Promise<{ notes?: NoteSummary[]; note?: Note; ok?: boolean; error?: string }> {
  const memoryDir = getMemoryDir();
  switch (name) {
    case "note_list":
      return { notes: await listNotesIn(memoryDir) };
    case "note_create": {
      const title = typeof args.title === "string" ? args.title : undefined;
      const content = typeof args.content === "string" ? args.content : "";
      return { note: await createNoteIn(memoryDir, title, content) };
    }
    case "note_read": {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) return { error: "note_read requires a non-empty 'id' string" };
      const note = await readNoteIn(memoryDir, id);
      return note ? { note } : { error: `Note not found: ${id}` };
    }
    case "note_save": {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      const content = typeof args.content === "string" ? args.content : "";
      if (!id) return { error: "note_save requires a non-empty 'id' string" };
      return { note: await saveNoteIn(memoryDir, id, content) };
    }
    case "note_delete": {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) return { error: "note_delete requires a non-empty 'id' string" };
      await deleteNoteIn(memoryDir, id);
      return { ok: true };
    }
    default:
      return { error: `Unknown note tool: ${name}` };
  }
}

export function buildNotesEditPrompt(input: NoteEditProposalInput): string {
  const prompt = String(input.prompt ?? "").trim();
  const selectedText = String(input.selectedText ?? "");
  const beforeText = String(input.beforeText ?? "");
  const afterText = String(input.afterText ?? "");
  const documentText = String(input.documentText ?? "");

  return [
    "Rewrite the selected text according to the instruction.",
    "Return only the rewritten text with no explanation, markdown, or surrounding quotes.",
    "If the instruction is clearly a question about the selected text, you may return a concise answer instead.",
    "Keep the same language and preserve key facts unless the instruction asks otherwise.",
    "When rewriting, make sure the result fits naturally between the surrounding text and stays consistent with the overall document.",
    "",
    "[Instruction]",
    prompt,
    "",
    "[TextBeforeSelection]",
    beforeText,
    "",
    "[SelectedText]",
    selectedText,
    "",
    "[TextAfterSelection]",
    afterText,
    "",
    "[FullDocument]",
    documentText,
  ].join("\n");
}

export function buildNotesSpellCheckPrompt(input: NoteSpellCheckInput): string {
  const selectedText = String(input.selectedText ?? "");
  const beforeText = String(input.beforeText ?? "");
  const afterText = String(input.afterText ?? "");
  const documentText = String(input.documentText ?? "");

  return [
    "Correct spelling and grammar in the selected text only.",
    "Do not rewrite, rephrase, change tone, or alter word choice except to fix clear typos or grammatical mistakes.",
    "Preserve the original meaning, formatting, line breaks, and punctuation style as much as possible.",
    "Return only the corrected text with no explanation, markdown, or surrounding quotes.",
    "When correcting, make sure the result fits naturally between the surrounding text and stays consistent with the overall document.",
    "",
    "[TextBeforeSelection]",
    beforeText,
    "",
    "[SelectedText]",
    selectedText,
    "",
    "[TextAfterSelection]",
    afterText,
    "",
    "[FullDocument]",
    documentText,
  ].join("\n");
}

export async function proposeNoteSpellCheck(input: NoteSpellCheckInput): Promise<NoteEditProposal> {
  const selectedText = String(input.selectedText ?? "");
  if (!selectedText.trim()) {
    throw new Error("Cannot spell check an empty selection.");
  }

  const apiKey = (await resolveOpenAIApiKey()).trim();
  if (!apiKey) {
    throw new Error("OpenAI API key required.");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create(
    {
      model: OPENAI_CHAT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a copy editor for a local notes app. Correct spelling and grammar only. Do not rewrite for style. Output only the corrected replacement text for the selected span.",
        },
        {
          role: "user",
          content: buildNotesSpellCheckPrompt({
            selectedText,
            beforeText: String(input.beforeText ?? ""),
            afterText: String(input.afterText ?? ""),
            documentText: String(input.documentText ?? ""),
          }),
        },
      ],
      reasoning_effort: "low",
      max_completion_tokens: 1200,
    },
    { signal: AbortSignal.timeout(20_000) },
  );

  const proposedText = response.choices[0]?.message?.content?.trim() ?? "";
  if (!proposedText) {
    throw new Error("The model returned an empty spell check result.");
  }
  return { proposedText };
}

export async function proposeNoteEdit(input: NoteEditProposalInput): Promise<NoteEditProposal> {
  const selectedText = String(input.selectedText ?? "");
  const prompt = String(input.prompt ?? "").trim();
  if (!selectedText.trim()) {
    throw new Error("Cannot propose edit for empty selection.");
  }
  if (!prompt) {
    throw new Error("Prompt is required.");
  }

  const apiKey = (await resolveOpenAIApiKey()).trim();
  if (!apiKey) {
    throw new Error("OpenAI API key required.");
  }

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create(
    {
      model: OPENAI_CHAT_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an editing assistant for a local notes app. Output only replacement text for the selected span.",
        },
        {
          role: "user",
          content: buildNotesEditPrompt({
            selectedText,
            prompt,
            beforeText: String(input.beforeText ?? ""),
            afterText: String(input.afterText ?? ""),
            documentText: String(input.documentText ?? ""),
          }),
        },
      ],
      reasoning_effort: "medium",
      max_completion_tokens: 1200,
    },
    { signal: AbortSignal.timeout(20_000) },
  );

  const proposedText = response.choices[0]?.message?.content?.trim() ?? "";
  if (!proposedText) {
    throw new Error("The model returned an empty edit proposal.");
  }
  return { proposedText };
}

export function registerNotesHandlers(): void {
  ipcMain.handle("notes:list", () => listNotes());
  ipcMain.handle("notes:create", (_e, title?: string, content?: string) => createNote(title, content));
  ipcMain.handle("notes:read", (_e, id: string) => readNote(id ?? ""));
  ipcMain.handle("notes:save", (_e, id: string, content: string) => saveNote(id ?? "", content ?? ""));
  ipcMain.handle("notes:delete", (_e, id: string) => deleteNote(id ?? ""));
  ipcMain.handle("notes:showInFolder", (_e, id: string) => showNoteInFolder(id ?? ""));
  ipcMain.handle("notes:proposeEdit", (_e, input: NoteEditProposalInput) => proposeNoteEdit(input));
  ipcMain.handle("notes:spellCheck", (_e, input: NoteSpellCheckInput) => proposeNoteSpellCheck(input));
  ipcMain.handle("notes:print", async (_e, html: unknown, jobName?: unknown) => {
    if (typeof html !== "string" || !html.trim()) {
      throw new Error("Print HTML is required.");
    }
    const { printHtml } = await import("./notePrint");
    return printHtml(html, typeof jobName === "string" ? jobName : undefined);
  });
}
