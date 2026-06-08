import { readFile, rename, writeFile } from "fs/promises";
import { join } from "path";
import { CLIPPINGS_NOTE_TITLE } from "../shared/writing";
import { normalizeTags } from "../shared/tags";
import { CLIPPINGS_FILE, getMemoryDir } from "./memory";
import { createNoteIn, listNotesIn, normalizeContent, readNoteIn, saveNoteIn } from "./writing";
import { fileExists } from "./utils";

const CLIPPINGS_BACKUP_FILE = "clippings.json.bak";
const CLIPPINGS_NOTE_HEADING = `# ${CLIPPINGS_NOTE_TITLE}\n\n`;

interface ClippingRow {
  content: string;
  tags: string[];
  createdAt: number;
}

function getClippingsPathIn(memoryDir: string): string {
  return join(memoryDir, CLIPPINGS_FILE);
}

function getClippingsBackupPathIn(memoryDir: string): string {
  return join(memoryDir, CLIPPINGS_BACKUP_FILE);
}

function parseClippingRows(raw: unknown): ClippingRow[] {
  const rows: unknown[] = Array.isArray((raw as { clippings?: unknown })?.clippings)
    ? ((raw as { clippings: unknown[] }).clippings ?? [])
    : Array.isArray(raw)
      ? raw
      : [];
  const out: ClippingRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const kind = String(record.kind ?? "text");
    if (kind !== "text") continue;
    const content = String(record.content ?? "").trim();
    if (!content) continue;
    const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
    out.push({
      content,
      tags: normalizeTags(record.tags),
      createdAt,
    });
  }
  return out;
}

async function loadClippingsForMigration(memoryDir: string): Promise<ClippingRow[]> {
  const path = getClippingsPathIn(memoryDir);
  if (!(await fileExists(path))) return [];
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as unknown;
    return parseClippingRows(raw);
  } catch {
    return [];
  }
}

function clippingsNoteBody(lines: string[]): string {
  return `${CLIPPINGS_NOTE_HEADING}${lines.join("\n")}\n`;
}

function formatClippingLine(index: number, content: string, tags: string[]): string {
  const tagSuffix = tags.length > 0 ? ` ${tags.map((tag) => `#${tag}`).join(" ")}` : "";
  return `${index}. ${content}${tagSuffix}`;
}

function nextNumberedListIndex(content: string): number {
  let max = 0;
  for (const line of normalizeContent(content).split("\n")) {
    const match = /^\s*(\d+)\.\s/.exec(line);
    if (!match) continue;
    max = Math.max(max, Number.parseInt(match[1], 10));
  }
  return max;
}

async function findClippingsNoteId(memoryDir: string): Promise<string | null> {
  const notes = await listNotesIn(memoryDir);
  const match = notes.find((note) => note.title.trim().toLowerCase() === CLIPPINGS_NOTE_TITLE.toLowerCase());
  return match?.id ?? null;
}

async function archiveClippingsFile(memoryDir: string): Promise<void> {
  const source = getClippingsPathIn(memoryDir);
  const backup = getClippingsBackupPathIn(memoryDir);
  if (!(await fileExists(source))) return;
  if (await fileExists(backup)) {
    await writeFile(source, JSON.stringify({ clippings: [] }, null, 2), "utf-8");
    return;
  }
  await rename(source, backup);
}

export async function migrateClippingsToNoteIn(memoryDir: string): Promise<void> {
  const clippingsPath = getClippingsPathIn(memoryDir);
  const backupPath = getClippingsBackupPathIn(memoryDir);
  if (!(await fileExists(clippingsPath)) || (await fileExists(backupPath))) return;

  const rows = await loadClippingsForMigration(memoryDir);
  if (rows.length === 0) {
    await archiveClippingsFile(memoryDir);
    return;
  }

  const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt);
  const existingId = await findClippingsNoteId(memoryDir);

  if (existingId) {
    const existing = await readNoteIn(memoryDir, existingId);
    const base = normalizeContent(existing?.content ?? "").trimEnd();
    let nextIndex = nextNumberedListIndex(base);
    const newLines = sorted.map((row) => formatClippingLine(++nextIndex, row.content, row.tags));
    const merged = `${base}\n${newLines.join("\n")}\n`;
    await saveNoteIn(memoryDir, existingId, merged);
  } else {
    const lines = sorted.map((row, index) => formatClippingLine(index + 1, row.content, row.tags));
    await createNoteIn(memoryDir, CLIPPINGS_NOTE_TITLE, clippingsNoteBody(lines));
  }

  await archiveClippingsFile(memoryDir);
}

export async function migrateClippingsToNote(): Promise<void> {
  await migrateClippingsToNoteIn(getMemoryDir());
}
