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
import { readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { getMemoryDir } from "./memory";
import { fileExists } from "./utils";

const DOC_FILE = "writing.md";

export interface WritingDocSnapshot {
  /** Markdown body. Always a string, "" when no doc has been written yet. */
  content: string;
  /** Epoch ms of last write, or 0 if no doc on disk. */
  updatedAt: number;
}

function getDocPath(): string {
  return join(getMemoryDir(), DOC_FILE);
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
  // Normalize line endings to \n so a doc that round-trips through the model
  // or through OS copy/paste does not accumulate \r characters.
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
  ipcMain.handle("writing:write", (_e, content: string) => writeDoc(content ?? ""));
}
