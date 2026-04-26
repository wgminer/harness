import { ipcMain } from "electron";
import { randomUUID } from "crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { UNTITLED_NOTE_TITLE, type WritingNote, type WritingNoteSummary } from "../shared/writing";
import { getMemoryDir } from "./memory";
import { fileExists } from "./utils";

const LEGACY_DOC_FILE = "writing.md";
const NOTES_INDEX_FILE = "notes.json";
const NOTES_DIR = "notes";
const LEGACY_IMPORTED_NOTE_TITLE = "Imported note";
const DEFAULT_NOTE_TITLE = "Note";

interface WritingIndexEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface WritingIndex {
  notes: WritingIndexEntry[];
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

function titleFromContent(content: string, fallback: string): string {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return fallback;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80).trimEnd()}...` : firstLine;
}

function toSummary(entry: WritingIndexEntry): WritingNoteSummary {
  return {
    id: entry.id,
    title: entry.title,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function sortByUpdatedAtDesc(entries: WritingIndexEntry[]): WritingIndexEntry[] {
  return [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function ensureNotesDirIn(memoryDir: string): Promise<void> {
  await mkdir(getNotesDirPathIn(memoryDir), { recursive: true });
}

async function loadNotesIndexIn(memoryDir: string): Promise<WritingIndex> {
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
        if (
          typeof id !== "string" ||
          typeof title !== "string" ||
          typeof createdAt !== "number" ||
          typeof updatedAt !== "number"
        ) {
          return null;
        }
        return { id, title, createdAt, updatedAt };
      })
      .filter((entry): entry is WritingIndexEntry => entry != null);
    return { notes: sortByUpdatedAtDesc(notes) };
  } catch {
    return { notes: [] };
  }
}

async function saveNotesIndexIn(memoryDir: string, index: WritingIndex): Promise<void> {
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
        title: titleFromContent(normalized, LEGACY_IMPORTED_NOTE_TITLE),
        createdAt,
        updatedAt: createdAt,
      },
    ],
  });
}

async function ensureNotesReadyIn(memoryDir: string): Promise<WritingIndex> {
  await ensureNotesDirIn(memoryDir);
  await migrateLegacyDocIn(memoryDir);
  return loadNotesIndexIn(memoryDir);
}

export async function listNotesIn(memoryDir: string): Promise<WritingNoteSummary[]> {
  const index = await ensureNotesReadyIn(memoryDir);
  return sortByUpdatedAtDesc(index.notes).map(toSummary);
}

export async function listNotes(): Promise<WritingNoteSummary[]> {
  return listNotesIn(getMemoryDir());
}

export async function createNoteIn(memoryDir: string, title?: string): Promise<WritingNote> {
  const index = await ensureNotesReadyIn(memoryDir);
  const id = randomUUID();
  const now = Date.now();
  const entry: WritingIndexEntry = {
    id,
    title: normalizeTitle(title, `${DEFAULT_NOTE_TITLE} ${index.notes.length + 1}`),
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(getNotePathIn(memoryDir, id), "", "utf-8");
  await saveNotesIndexIn(memoryDir, { notes: [entry, ...index.notes] });
  return { ...entry, content: "" };
}

export async function createNote(title?: string): Promise<WritingNote> {
  return createNoteIn(getMemoryDir(), title);
}

export async function readNoteIn(memoryDir: string, id: string): Promise<WritingNote | null> {
  const cleanId = String(id ?? "").trim();
  if (!cleanId) return null;
  const index = await ensureNotesReadyIn(memoryDir);
  const entry = index.notes.find((item) => item.id === cleanId);
  if (!entry) return null;
  const notePath = getNotePathIn(memoryDir, cleanId);
  const content = (await fileExists(notePath)) ? await readFile(notePath, "utf-8") : "";
  return { ...entry, content };
}

export async function readNote(id: string): Promise<WritingNote | null> {
  return readNoteIn(getMemoryDir(), id);
}

export async function saveNoteIn(memoryDir: string, id: string, content: string): Promise<WritingNote> {
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
  const updatedEntry: WritingIndexEntry = {
    ...current,
    title: titleFromContent(normalized, current.title || UNTITLED_NOTE_TITLE),
    updatedAt: now,
  };
  const next = [...index.notes];
  next[noteIndex] = updatedEntry;
  await saveNotesIndexIn(memoryDir, { notes: next });
  return { ...updatedEntry, content: normalized };
}

export async function saveNote(id: string, content: string): Promise<WritingNote> {
  return saveNoteIn(getMemoryDir(), id, content);
}

export async function deleteNoteIn(memoryDir: string, id: string): Promise<WritingNoteSummary[]> {
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

export async function deleteNote(id: string): Promise<WritingNoteSummary[]> {
  return deleteNoteIn(getMemoryDir(), id);
}

async function getOrCreatePrimaryNoteIn(memoryDir: string): Promise<WritingNote> {
  const notes = await listNotesIn(memoryDir);
  if (notes.length > 0) {
    const existing = await readNoteIn(memoryDir, notes[0].id);
    if (existing) return existing;
  }
  return createNoteIn(memoryDir, DEFAULT_NOTE_TITLE);
}

/**
 * Tool-call dispatch for the assistant. Kept here rather than in
 * assistantTools.ts so all writing-surface logic lives in one module.
 */
export async function executeDocTool(
  name: "doc_read" | "doc_write" | "doc_append",
  args: Record<string, unknown>,
): Promise<{ content: string; updatedAt: number; noteId: string } | { error: string }> {
  const memoryDir = getMemoryDir();
  const primary = await getOrCreatePrimaryNoteIn(memoryDir);
  switch (name) {
    case "doc_read":
      return { content: primary.content, updatedAt: primary.updatedAt, noteId: primary.id };
    case "doc_write": {
      const content = typeof args.content === "string" ? args.content : "";
      const saved = await saveNoteIn(memoryDir, primary.id, content);
      return { content: saved.content, updatedAt: saved.updatedAt, noteId: saved.id };
    }
    case "doc_append": {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content) {
        return { error: "doc_append requires a non-empty 'content' string" };
      }
      const needsSeparator = primary.content.length > 0 && !primary.content.endsWith("\n");
      const combined = primary.content + (needsSeparator ? "\n\n" : "") + content;
      const saved = await saveNoteIn(memoryDir, primary.id, combined);
      return { content: saved.content, updatedAt: saved.updatedAt, noteId: saved.id };
    }
    default:
      return { error: `Unknown writing tool: ${name}` };
  }
}

export function registerWritingHandlers(): void {
  ipcMain.handle("writing:notes:list", () => listNotes());
  ipcMain.handle("writing:notes:create", (_e, title?: string) => createNote(title));
  ipcMain.handle("writing:notes:read", (_e, id: string) => readNote(id ?? ""));
  ipcMain.handle("writing:notes:save", (_e, id: string, content: string) => saveNote(id ?? "", content ?? ""));
  ipcMain.handle("writing:notes:delete", (_e, id: string) => deleteNote(id ?? ""));
}
