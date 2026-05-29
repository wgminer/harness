import { ipcMain } from "electron";
import { mkdirSync, existsSync } from "fs";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { ClippingItem, ClippingKind, ClippingsPayload } from "../shared/clippings";
import { isClippingKind } from "../shared/clippings";
import { getMemoryDir, CLIPPINGS_FILE } from "./memory";
import { generateId, fileExists } from "./utils";
import { applyTagPatch, normalizeTags } from "../shared/tags";

interface ClippingsState {
  clippings: ClippingItem[];
}

function getClippingsFilePath(): string {
  return join(getMemoryDir(), CLIPPINGS_FILE);
}

function getClippingsFilePathIn(memoryDir: string): string {
  return join(memoryDir, CLIPPINGS_FILE);
}

function migrateRawClipping(raw: unknown): ClippingItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const content = String(r.content ?? "").trim();
  if (!id || !content) return null;
  const kindRaw = r.kind;
  const kind: ClippingKind = isClippingKind(kindRaw) ? kindRaw : "text";
  if (kind !== "text") return null;
  const createdAt = typeof r.createdAt === "number" ? r.createdAt : Date.now();
  const updatedAt = typeof r.updatedAt === "number" ? r.updatedAt : createdAt;
  const tags = normalizeTags(r.tags);
  const metadata =
    r.metadata && typeof r.metadata === "object" ? (r.metadata as Record<string, unknown>) : undefined;
  return {
    id,
    kind,
    content,
    tags,
    createdAt,
    updatedAt,
    ...(metadata ? { metadata } : {}),
  };
}

export async function loadClippingsIn(memoryDir: string): Promise<ClippingsState> {
  const path = getClippingsFilePathIn(memoryDir);
  if (!(await fileExists(path))) return { clippings: [] };
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    const rows: unknown[] = Array.isArray(parsed?.clippings)
      ? parsed.clippings
      : Array.isArray(parsed)
        ? parsed
        : [];
    const clippings = rows.map(migrateRawClipping).filter((c): c is ClippingItem => c !== null);
    return { clippings };
  } catch {
    return { clippings: [] };
  }
}

async function loadClippings(): Promise<ClippingsState> {
  return loadClippingsIn(getMemoryDir());
}

export async function saveClippingsIn(memoryDir: string, state: ClippingsState): Promise<void> {
  if (!existsSync(memoryDir)) {
    mkdirSync(memoryDir, { recursive: true });
  }
  await writeFile(
    getClippingsFilePathIn(memoryDir),
    JSON.stringify({ clippings: state.clippings }, null, 2),
    "utf-8",
  );
}

async function saveClippings(state: ClippingsState): Promise<void> {
  await saveClippingsIn(getMemoryDir(), state);
}

export type ClippingAction =
  | { kind: "list"; args?: Record<string, unknown> }
  | { kind: "create"; args: Record<string, unknown> }
  | { kind: "update"; args: Record<string, unknown> }
  | { kind: "delete"; args: Record<string, unknown> };

function filterByTag(clippings: ClippingItem[], tag: unknown): ClippingItem[] {
  const needle = String(tag ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  if (!needle) return clippings;
  return clippings.filter((c) => normalizeTags(c.tags).includes(needle));
}

export function applyClippingAction(
  state: ClippingsState,
  action: ClippingAction,
  nowMs = Date.now(),
  idFactory: () => string = () => generateId("clip"),
): ClippingsPayload {
  const nextState: ClippingsState = { clippings: [...state.clippings] };

  if (action.kind === "list") {
    const filtered = filterByTag(nextState.clippings, action.args?.tag);
    return { clippings: filtered, lastAction: "list" };
  }

  if (action.kind === "create") {
    const content = String(action.args.content ?? "").trim();
    if (!content) {
      return { ...nextState, lastAction: "create", error: "Clipping content is required" };
    }
    const kindRaw = action.args.kind;
    const kind: ClippingKind = isClippingKind(kindRaw) ? kindRaw : "text";
    if (kind !== "text") {
      return { ...nextState, lastAction: "create", error: `Clipping kind "${kind}" is not supported yet` };
    }
    const tags = normalizeTags(action.args.tags);
    const metadata =
      action.args.metadata && typeof action.args.metadata === "object"
        ? (action.args.metadata as Record<string, unknown>)
        : undefined;
    const clipping: ClippingItem = {
      id: idFactory(),
      kind,
      content,
      tags,
      createdAt: nowMs,
      updatedAt: nowMs,
      ...(metadata ? { metadata } : {}),
    };
    nextState.clippings.push(clipping);
    return { ...nextState, lastAction: "create", affectedIds: [clipping.id] };
  }

  if (action.kind === "update") {
    const id = String(action.args.id ?? "").trim();
    if (!id) return { ...nextState, lastAction: "update", error: "Clipping id is required" };
    const idx = nextState.clippings.findIndex((c) => c.id === id);
    if (idx === -1) return { ...nextState, lastAction: "update", error: `Clipping not found: ${id}` };

    const existing = nextState.clippings[idx];
    const next: ClippingItem = { ...existing, updatedAt: nowMs };
    if (typeof action.args.content === "string") {
      const content = action.args.content.trim();
      if (!content) {
        return { ...nextState, lastAction: "update", error: "Clipping content cannot be empty" };
      }
      next.content = content;
    }
    const tagPatch = applyTagPatch(next.tags, action.args);
    if (tagPatch !== undefined) next.tags = tagPatch;
    if (action.args.metadata && typeof action.args.metadata === "object") {
      const metaPatch = action.args.metadata as Record<string, unknown>;
      next.metadata = { ...(next.metadata ?? {}), ...metaPatch };
    }
    nextState.clippings[idx] = next;
    return { ...nextState, lastAction: "update", affectedIds: [id] };
  }

  const id = String(action.args.id ?? "").trim();
  if (!id) return { ...nextState, lastAction: "delete", error: "Clipping id is required" };
  const before = nextState.clippings.length;
  nextState.clippings = nextState.clippings.filter((c) => c.id !== id);
  if (nextState.clippings.length === before) {
    return { ...nextState, lastAction: "delete", error: `Clipping not found: ${id}` };
  }
  return { ...nextState, lastAction: "delete", affectedIds: [id] };
}

export async function listClippings(tag?: string): Promise<ClippingsPayload> {
  const state = await loadClippings();
  return applyClippingAction(state, { kind: "list", args: tag ? { tag } : {} });
}

export async function createClipping(args: Record<string, unknown>): Promise<ClippingsPayload> {
  const state = await loadClippings();
  const payload = applyClippingAction(state, { kind: "create", args }, Date.now());
  if (!payload.error) await saveClippings({ clippings: payload.clippings });
  return payload;
}

export async function updateClipping(args: Record<string, unknown>): Promise<ClippingsPayload> {
  const state = await loadClippings();
  const payload = applyClippingAction(state, { kind: "update", args }, Date.now());
  if (!payload.error) await saveClippings({ clippings: payload.clippings });
  return payload;
}

export async function deleteClipping(args: Record<string, unknown>): Promise<ClippingsPayload> {
  const state = await loadClippings();
  const payload = applyClippingAction(state, { kind: "delete", args }, Date.now());
  if (!payload.error) await saveClippings({ clippings: payload.clippings });
  return payload;
}

export async function executeClippingTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ClippingsPayload | { error: string }> {
  switch (name) {
    case "clipping_list":
      return listClippings(typeof args.tag === "string" ? args.tag : undefined);
    case "clipping_create":
      return createClipping(args);
    case "clipping_update":
      return updateClipping(args);
    case "clipping_delete":
      return deleteClipping(args);
    default:
      return { error: `Unknown clipping tool: ${name}` };
  }
}

export function registerClippingsHandlers(): void {
  ipcMain.handle("clippings:list", (_e, tag?: string) => listClippings(tag));
  ipcMain.handle("clippings:create", (_e, content: string, tags?: string[]) =>
    createClipping({ content, tags }),
  );
  ipcMain.handle(
    "clippings:update",
    (_e, payload: {
      id: string;
      content?: string;
      tags?: string[];
      add_tags?: string[];
      remove_tags?: string[];
    }) => updateClipping(payload as Record<string, unknown>),
  );
  ipcMain.handle("clippings:delete", (_e, id: string) => deleteClipping({ id }));
}
