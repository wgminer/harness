import { ipcMain, shell } from "electron";
import { randomUUID } from "crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { UNTITLED_NOTE_TITLE, type Note, type NoteSummary } from "../shared/writing";
import { getMemoryDir } from "./memory";
import { fileExists } from "./utils";

const LEGACY_DOC_FILE = "writing.md";
const NOTES_INDEX_FILE = "notes.json";
const NOTES_DIR = "notes";
const LEGACY_IMPORTED_NOTE_TITLE = "Imported note";
const DEFAULT_NOTE_TITLE = "Note";

interface NotesIndexEntry {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
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

function titleFromContent(content: string, fallback: string): string {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return fallback;
  return firstLine.length > 80 ? `${firstLine.slice(0, 80).trimEnd()}...` : firstLine;
}

function toSummary(entry: NotesIndexEntry): NoteSummary {
  return {
    id: entry.id,
    title: entry.title,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
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
        title: titleFromContent(normalized, LEGACY_IMPORTED_NOTE_TITLE),
        createdAt,
        updatedAt: createdAt,
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
  return sortByUpdatedAtDesc(index.notes).map(toSummary);
}

export async function listNotes(): Promise<NoteSummary[]> {
  return listNotesIn(getMemoryDir());
}

export async function createNoteIn(memoryDir: string, title?: string, content = ""): Promise<Note> {
  const index = await ensureNotesReadyIn(memoryDir);
  const id = randomUUID();
  const now = Date.now();
  const normalizedContent = normalizeContent(content);
  const entry: NotesIndexEntry = {
    id,
    title: normalizeTitle(title, titleFromContent(normalizedContent, `${DEFAULT_NOTE_TITLE} ${index.notes.length + 1}`)),
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(getNotePathIn(memoryDir, id), normalizedContent, "utf-8");
  await saveNotesIndexIn(memoryDir, { notes: [entry, ...index.notes] });
  return { ...entry, content: normalizedContent };
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
    title: titleFromContent(normalized, current.title || UNTITLED_NOTE_TITLE),
    updatedAt: now,
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

export function registerNotesHandlers(): void {
  ipcMain.handle("notes:list", () => listNotes());
  ipcMain.handle("notes:create", (_e, title?: string, content?: string) => createNote(title, content));
  ipcMain.handle("notes:read", (_e, id: string) => readNote(id ?? ""));
  ipcMain.handle("notes:save", (_e, id: string, content: string) => saveNote(id ?? "", content ?? ""));
  ipcMain.handle("notes:delete", (_e, id: string) => deleteNote(id ?? ""));
  ipcMain.handle("notes:showInFolder", (_e, id: string) => showNoteInFolder(id ?? ""));
}
