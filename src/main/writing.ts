/**
 * Writing surface — a single persisted markdown document the assistant and
 * user can collaborate on, separate from ephemeral chat.
 *
 * This is a first draft:
 *   - exactly one document per app install (no tabs, no history, no titles
 *     beyond what the markdown first-line heading implies)
 *   - stored as plain markdown on disk under the memory dir
 *   - explicit save semantics (the renderer decides when to persist; the
 *     model writes via tool calls that always persist immediately)
 *   - concurrent writes are last-writer-wins; each save returns the new
 *     updatedAt so the renderer can detect out-of-band changes from a tool
 *     call and refresh.
 *
 * Future design session will likely split this into multiple named docs with
 * their own sidebar entries and richer tooling. For now we keep the surface
 * area minimal so the tool schema is cheap for the model to learn and we
 * don't paint ourselves into a corner.
 */

import { ipcMain } from "electron";
import { randomUUID } from "crypto";
import { readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { MAX_WRITING_CHECKPOINTS } from "../shared/writing";
import { getMemoryDir } from "./memory";
import { fileExists } from "./utils";

const DOC_FILE = "writing.md";
const CHECKPOINTS_FILE = "writing-checkpoints.json";

export interface WritingDocSnapshot {
  /** Markdown body. Always a string, "" when no doc has been written yet. */
  content: string;
  /** Epoch ms of last write, or 0 if no doc on disk. */
  updatedAt: number;
}

export interface WritingCheckpoint {
  id: string;
  content: string;
  createdAt: number;
}

function getDocPath(): string {
  return join(getMemoryDir(), DOC_FILE);
}

function getCheckpointsPath(): string {
  return join(getMemoryDir(), CHECKPOINTS_FILE);
}

function normalizeContent(content: string): string {
  // Normalize line endings so checkpoints and saved docs are consistent.
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export async function readDoc(): Promise<WritingDocSnapshot> {
  const path = getDocPath();
  if (!(await fileExists(path))) {
    return { content: "", updatedAt: 0 };
  }
  const [content, info] = await Promise.all([
    readFile(path, "utf-8"),
    stat(path),
  ]);
  return { content, updatedAt: info.mtimeMs };
}

export async function writeDoc(content: string): Promise<WritingDocSnapshot> {
  const path = getDocPath();
  const normalized = normalizeContent(content);
  await writeFile(path, normalized, "utf-8");
  const info = await stat(path);
  return { content: normalized, updatedAt: info.mtimeMs };
}

export async function appendDoc(suffix: string): Promise<WritingDocSnapshot> {
  const current = await readDoc();
  if (!suffix) return current;
  const needsSeparator =
    current.content.length > 0 && !current.content.endsWith("\n");
  const combined =
    current.content + (needsSeparator ? "\n\n" : "") + suffix;
  return writeDoc(combined);
}

export async function listCheckpoints(): Promise<WritingCheckpoint[]> {
  const path = getCheckpointsPath();
  if (!(await fileExists(path))) return [];
  try {
    const raw = await readFile(path, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const id = (item as { id?: unknown }).id;
        const content = (item as { content?: unknown }).content;
        const createdAt = (item as { createdAt?: unknown }).createdAt;
        if (typeof id !== "string" || typeof content !== "string" || typeof createdAt !== "number") {
          return null;
        }
        return { id, content, createdAt };
      })
      .filter((entry): entry is WritingCheckpoint => entry != null)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_WRITING_CHECKPOINTS);
  } catch {
    return [];
  }
}

async function writeCheckpoints(next: WritingCheckpoint[]): Promise<void> {
  const path = getCheckpointsPath();
  await writeFile(path, JSON.stringify(next.slice(0, MAX_WRITING_CHECKPOINTS), null, 2), "utf-8");
}

export async function createCheckpoint(content: string): Promise<WritingCheckpoint[]> {
  const existing = await listCheckpoints();
  const checkpoint: WritingCheckpoint = {
    id: randomUUID(),
    content: normalizeContent(content),
    createdAt: Date.now(),
  };
  await writeCheckpoints([checkpoint, ...existing]);
  return listCheckpoints();
}

async function writeDocWithCheckpoint(content: string): Promise<WritingDocSnapshot> {
  const snapshot = await writeDoc(content);
  await createCheckpoint(snapshot.content);
  return snapshot;
}

export async function deleteCheckpoint(id: string): Promise<WritingCheckpoint[]> {
  if (!id) return listCheckpoints();
  const existing = await listCheckpoints();
  const next = existing.filter((item) => item.id !== id);
  await writeCheckpoints(next);
  return next;
}

/**
 * Tool-call dispatch for the assistant. Kept here rather than in
 * assistantTools.ts so all writing-surface logic lives in one module.
 */
export async function executeDocTool(
  name: "doc_read" | "doc_write" | "doc_append",
  args: Record<string, unknown>,
): Promise<WritingDocSnapshot | { error: string }> {
  switch (name) {
    case "doc_read":
      return readDoc();
    case "doc_write": {
      const content = typeof args.content === "string" ? args.content : "";
      return writeDoc(content);
    }
    case "doc_append": {
      const content = typeof args.content === "string" ? args.content : "";
      if (!content) {
        return { error: "doc_append requires a non-empty 'content' string" };
      }
      return appendDoc(content);
    }
    default:
      return { error: `Unknown writing tool: ${name}` };
  }
}

export function registerWritingHandlers(): void {
  ipcMain.handle("writing:read", () => readDoc());
  ipcMain.handle("writing:write", (_e, content: string) => writeDocWithCheckpoint(content ?? ""));
  ipcMain.handle("writing:checkpoints:list", () => listCheckpoints());
  ipcMain.handle("writing:checkpoints:create", (_e, content: string) => createCheckpoint(content ?? ""));
  ipcMain.handle("writing:checkpoints:delete", (_e, id: string) => deleteCheckpoint(id ?? ""));
}
