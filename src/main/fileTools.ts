import { ipcMain } from "electron";
import { readdirSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync, statSync } from "fs";
import { join, resolve } from "path";
import { app } from "electron";

const MAX_FILE_SIZE = 1024 * 1024; // 1MB
const ALLOWED_ROOTS_KEY = "file_tools_allowed_roots";

function getAllowedRoots(): string[] {
  const userData = app.getPath("userData");
  const home = app.getPath("home");
  const desktop = app.getPath("desktop");
  return [userData, home, desktop];
}

function isPathAllowed(filePath: string): boolean {
  const resolved = resolve(filePath);
  const roots = getAllowedRoots();
  return roots.some((root) => resolved === root || resolved.startsWith(root + join.sep));
}

function listDirectory(pathArg: string): string {
  try {
    const resolved = resolve(pathArg);
    if (!isPathAllowed(resolved)) return JSON.stringify({ error: "Path not under allowed roots" });
    if (!existsSync(resolved)) return JSON.stringify({ error: "Path does not exist" });
    const stat = statSync(resolved);
    if (!stat.isDirectory()) return JSON.stringify({ error: "Not a directory" });
    const entries = readdirSync(resolved, { withFileTypes: true });
    const items = entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
    return JSON.stringify(items);
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

function readFile(pathArg: string): string {
  try {
    const resolved = resolve(pathArg);
    if (!isPathAllowed(resolved)) return JSON.stringify({ error: "Path not under allowed roots" });
    if (!existsSync(resolved)) return JSON.stringify({ error: "File does not exist" });
    const stat = statSync(resolved);
    if (stat.isDirectory()) return JSON.stringify({ error: "Is a directory" });
    if (stat.size > MAX_FILE_SIZE) return JSON.stringify({ error: "File too large (max 1MB)" });
    const content = readFileSync(resolved, "utf-8");
    return JSON.stringify({ content });
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

function writeFile(pathArg: string, content: string): string {
  try {
    const resolved = resolve(pathArg);
    if (!isPathAllowed(resolved)) return JSON.stringify({ error: "Path not under allowed roots" });
    writeFileSync(resolved, content, "utf-8");
    return JSON.stringify({ ok: true });
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

function deleteFile(pathArg: string): string {
  try {
    const resolved = resolve(pathArg);
    if (!isPathAllowed(resolved)) return JSON.stringify({ error: "Path not under allowed roots" });
    if (!existsSync(resolved)) return JSON.stringify({ error: "Path does not exist" });
    const stat = statSync(resolved);
    if (stat.isDirectory()) return JSON.stringify({ error: "Call delete_directory for directories" });
    unlinkSync(resolved);
    return JSON.stringify({ ok: true });
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

function createDirectory(pathArg: string): string {
  try {
    const resolved = resolve(pathArg);
    if (!isPathAllowed(resolved)) return JSON.stringify({ error: "Path not under allowed roots" });
    if (existsSync(resolved)) return JSON.stringify({ error: "Already exists" });
    mkdirSync(resolved, { recursive: true });
    return JSON.stringify({ ok: true });
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

export function executeFileTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "list_directory":
      return listDirectory(String(args.path ?? ""));
    case "read_file":
      return readFile(String(args.path ?? ""));
    case "write_file":
      return writeFile(String(args.path ?? ""), String(args.content ?? ""));
    case "delete_file":
      return deleteFile(String(args.path ?? ""));
    case "create_directory":
      return createDirectory(String(args.path ?? ""));
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

export function registerFileToolsHandlers(): void {
  ipcMain.handle("fileTools:execute", (_e, name: string, args: Record<string, unknown>) => executeFileTool(name, args));
  ipcMain.handle("fileTools:getAllowedRoots", () => getAllowedRoots());
}
