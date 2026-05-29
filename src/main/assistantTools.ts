import { ipcMain } from "electron";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getUserMemory, setUserMemory, searchConversations, getMemoryDir, TASKS_FILE } from "./memory";
import { generateId, fileExists } from "./utils";
import type { SearchResult } from "../shared/types";
import { applyTagPatch, normalizeTags } from "../shared/tags";
import {
  migrateTaskFields,
  normalizeTaskStatus,
  taskIsClearable,
  taskNeedsStatusMigration,
} from "../shared/taskStatus";
import type { TaskStatus } from "../shared/taskStatus";
import { rigSection } from "../shared/rigPage";
import { getSettings } from "./settings";
import { getWeatherForZip } from "./weather";
import { searchWebTavily } from "./webSearch";
import { executeNoteTool } from "./writing";
import { executeClippingTool } from "./clippings";

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

interface TaskState {
  tasks: TaskItem[];
}

interface TasksPayload extends TaskState {
  lastAction: "list" | "create" | "update" | "delete" | "clear_completed";
  affectedIds?: string[];
  error?: string;
}

interface MemoryFactsPayload {
  lastAction: "set_fact" | "list_facts";
  memory: Record<string, string>;
  key?: string;
}

interface MemorySearchPayload {
  lastAction: "search_conversations";
  query: string;
  results: SearchResult[];
}

function getTasksFilePath(): string {
  return join(getMemoryDir(), TASKS_FILE);
}

function getTasksFilePathIn(memoryDir: string): string {
  return join(memoryDir, TASKS_FILE);
}

function migrateRawTask(raw: unknown): TaskItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  const title = String(r.title ?? "").trim();
  if (!id || !title) return null;
  const createdAt = typeof r.createdAt === "number" ? r.createdAt : Date.now();
  const updatedAt = typeof r.updatedAt === "number" ? r.updatedAt : createdAt;
  const { status, tags } = migrateTaskFields(r);
  const metadata =
    r.metadata && typeof r.metadata === "object" ? (r.metadata as Record<string, unknown>) : undefined;
  return {
    id,
    title,
    status,
    tags,
    createdAt,
    updatedAt,
    ...(metadata ? { metadata } : {}),
  };
}

export async function loadTasksIn(memoryDir: string): Promise<TaskState> {
  const path = getTasksFilePathIn(memoryDir);
  if (!(await fileExists(path))) return { tasks: [] };
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    const rows: unknown[] = Array.isArray(parsed?.tasks)
      ? parsed.tasks
      : Array.isArray(parsed)
        ? parsed
        : [];
    const needsLegacyRewrite = rows.some(
      (r) => !!r && typeof r === "object" && taskNeedsStatusMigration(r as Record<string, unknown>),
    );
    const tasks = rows.map(migrateRawTask).filter((t): t is TaskItem => t !== null);
    const state: TaskState = { tasks };
    if (needsLegacyRewrite && tasks.length > 0) {
      await saveTasksIn(memoryDir, state);
    }
    return state;
  } catch {
    // If the file is corrupt, start fresh
  }
  return { tasks: [] };
}

async function loadTasks(): Promise<TaskState> {
  return loadTasksIn(getMemoryDir());
}

export async function saveTasksIn(memoryDir: string, state: TaskState): Promise<void> {
  await writeFile(getTasksFilePathIn(memoryDir), JSON.stringify({ tasks: state.tasks }, null, 2), "utf-8");
}

async function saveTasks(state: TaskState): Promise<void> {
  await saveTasksIn(getMemoryDir(), state);
}

export type TaskAction =
  | { kind: "list" }
  | { kind: "create"; args: Record<string, unknown> }
  | { kind: "update"; args: Record<string, unknown> }
  | { kind: "delete"; args: Record<string, unknown> }
  | { kind: "clear_completed" };

export function applyTaskAction(
  state: TaskState,
  action: TaskAction,
  nowMs = Date.now(),
  idFactory: () => string = () => generateId("task")
): TasksPayload {
  const nextState: TaskState = { tasks: [...state.tasks] };

  if (action.kind === "list") {
    return { ...nextState, lastAction: "list" };
  }

  if (action.kind === "create") {
    const title = String(action.args.title ?? "").trim();
    const metadata =
      (action.args.metadata && typeof action.args.metadata === "object"
        ? (action.args.metadata as Record<string, unknown>)
        : undefined) ?? undefined;
    if (!title) {
      return { ...nextState, lastAction: "create", error: "Task title is required" };
    }
    const status = normalizeTaskStatus(action.args.status) ?? "pending";
    const tags = normalizeTags(action.args.tags);
    const task: TaskItem = {
      id: idFactory(),
      title,
      status,
      tags,
      createdAt: nowMs,
      updatedAt: nowMs,
      ...(metadata ? { metadata } : {}),
    };
    nextState.tasks.push(task);
    return { ...nextState, lastAction: "create", affectedIds: [task.id] };
  }

  if (action.kind === "update") {
    const id = String(action.args.id ?? "").trim();
    if (!id) return { ...nextState, lastAction: "update", error: "Task id is required" };
    const idx = nextState.tasks.findIndex((t) => t.id === id);
    if (idx === -1) return { ...nextState, lastAction: "update", error: `Task not found: ${id}` };

    const existing = nextState.tasks[idx];
    const next: TaskItem = { ...existing, updatedAt: nowMs };
    if (typeof action.args.title === "string") {
      const title = action.args.title.trim();
      if (title) next.title = title;
    }
    if (typeof action.args.status === "string") {
      const status = normalizeTaskStatus(action.args.status);
      if (status) next.status = status;
    }
    const tagPatch = applyTagPatch(next.tags, action.args);
    if (tagPatch !== undefined) next.tags = tagPatch;
    if (action.args.metadata && typeof action.args.metadata === "object") {
      const metaPatch = action.args.metadata as Record<string, unknown>;
      next.metadata = { ...(next.metadata ?? {}), ...metaPatch };
    }
    nextState.tasks[idx] = next;
    return { ...nextState, lastAction: "update", affectedIds: [id] };
  }

  if (action.kind === "delete") {
    const id = String(action.args.id ?? "").trim();
    if (!id) return { ...nextState, lastAction: "delete", error: "Task id is required" };
    const before = nextState.tasks.length;
    nextState.tasks = nextState.tasks.filter((t) => t.id !== id);
    if (nextState.tasks.length === before) {
      return { ...nextState, lastAction: "delete", error: `Task not found: ${id}` };
    }
    return { ...nextState, lastAction: "delete", affectedIds: [id] };
  }

  const remaining: TaskItem[] = [];
  const removedIds: string[] = [];
  for (const t of nextState.tasks) {
    if (taskIsClearable(t.status)) removedIds.push(t.id);
    else remaining.push(t);
  }
  nextState.tasks = remaining;
  return { ...nextState, lastAction: "clear_completed", affectedIds: removedIds };
}

export async function listTasks(): Promise<TasksPayload> {
  const state = await loadTasks();
  return { ...state, lastAction: "list" };
}

export async function createTask(args: Record<string, unknown>): Promise<TasksPayload> {
  const state = await loadTasks();
  const payload = applyTaskAction(state, { kind: "create", args }, Date.now());
  if (!payload.error) await saveTasks({ tasks: payload.tasks });
  return payload;
}

export async function updateTask(args: Record<string, unknown>): Promise<TasksPayload> {
  const state = await loadTasks();
  const payload = applyTaskAction(state, { kind: "update", args }, Date.now());
  if (!payload.error) await saveTasks({ tasks: payload.tasks });
  return payload;
}

export async function deleteTask(args: Record<string, unknown>): Promise<TasksPayload> {
  const state = await loadTasks();
  const payload = applyTaskAction(state, { kind: "delete", args }, Date.now());
  if (!payload.error) await saveTasks({ tasks: payload.tasks });
  return payload;
}

export async function clearCompletedTasks(): Promise<TasksPayload> {
  const state = await loadTasks();
  const payload = applyTaskAction(state, { kind: "clear_completed" }, Date.now());
  await saveTasks({ tasks: payload.tasks });
  return payload;
}

async function setMemoryFact(args: Record<string, unknown>): Promise<MemoryFactsPayload> {
  const key = String(args.key ?? "").trim();
  const value = String(args.value ?? "").trim();

  if (!key) {
    const current = await getUserMemory();
    return {
      lastAction: "set_fact",
      memory: current,
      key,
    };
  }

  await setUserMemory(key, value);
  const memory = await getUserMemory();
  return {
    lastAction: "set_fact",
    memory,
    key,
  };
}

async function listMemoryFacts(): Promise<MemoryFactsPayload> {
  const memory = await getUserMemory();
  return {
    lastAction: "list_facts",
    memory,
  };
}

async function searchMemoryConversations(args: Record<string, unknown>): Promise<MemorySearchPayload> {
  const query = String(args.query ?? "").trim();
  const results = query ? await searchConversations(query) : [];
  return {
    lastAction: "search_conversations",
    query,
    results,
  };
}

function getDatetime(args: Record<string, unknown>): Record<string, string | number> {
  const now = new Date();
  const requested = String(args.timezone ?? "").trim();
  let timezone: string;
  try {
    if (requested) {
      new Intl.DateTimeFormat("en-US", { timeZone: requested }).format(now);
      timezone = requested;
    } else {
      timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    }
  } catch {
    return { error: `Invalid timezone: ${requested}` };
  }

  const utc_iso = now.toISOString();
  const epoch_ms = now.getTime();

  const offsetFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    timeZoneName: "longOffset",
  });
  const offset =
    offsetFormatter.formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";

  const calParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => calParts.find((p) => p.type === t)?.value ?? "";
  const local_iso = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;

  const formatted = new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);

  return { epoch_ms, utc_iso, timezone, offset, local_iso, formatted };
}

async function fetchWeather(args: Record<string, unknown>): Promise<unknown> {
  const argZip = typeof args.zip === "string" ? args.zip.trim() : "";
  let zip = argZip;
  if (!zip) {
    const settings = await getSettings();
    zip = settings.weather?.defaultZip?.trim() ?? "";
  }
  if (!zip) {
    return {
      error: `No ZIP provided and no default ZIP is set. Add one in ${rigSection("Tools")}.`,
    };
  }
  const daysRaw = typeof args.days === "number" ? args.days : Number.parseInt(String(args.days ?? ""), 10);
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(7, Math.floor(daysRaw)) : 3;
  return getWeatherForZip(zip, days);
}

async function fetchWebSearch(args: Record<string, unknown>): Promise<unknown> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const settings = await getSettings();
  const apiKey = settings.search?.tavilyApiKey?.trim() ?? "";
  const maxResultsRaw =
    typeof args.max_results === "number"
      ? args.max_results
      : Number.parseInt(String(args.max_results ?? ""), 10);
  const maxResults = Number.isFinite(maxResultsRaw) && maxResultsRaw > 0 ? maxResultsRaw : 5;
  return searchWebTavily(apiKey, query, maxResults);
}

export function isAssistantToolName(name: string): boolean {
  return [
    "task_list",
    "task_create",
    "task_update",
    "task_delete",
    "task_clear_completed",
    "memory_set_fact",
    "memory_list_facts",
    "memory_search_conversations",
    "get_datetime",
    "get_weather",
    "web_search",
    "note_list",
    "note_create",
    "note_read",
    "note_save",
    "note_delete",
    "clipping_list",
    "clipping_create",
    "clipping_update",
    "clipping_delete",
  ].includes(name);
}

export async function executeAssistantTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "task_list":
      return JSON.stringify(await listTasks());
    case "task_create":
      return JSON.stringify(await createTask(args));
    case "task_update":
      return JSON.stringify(await updateTask(args));
    case "task_delete":
      return JSON.stringify(await deleteTask(args));
    case "task_clear_completed":
      return JSON.stringify(await clearCompletedTasks());
    case "memory_set_fact":
      return JSON.stringify(await setMemoryFact(args));
    case "memory_list_facts":
      return JSON.stringify(await listMemoryFacts());
    case "memory_search_conversations":
      return JSON.stringify(await searchMemoryConversations(args));
    case "get_datetime":
      return JSON.stringify(getDatetime(args));
    case "get_weather":
      return JSON.stringify(await fetchWeather(args));
    case "web_search":
      return JSON.stringify(await fetchWebSearch(args));
    case "note_list":
    case "note_create":
    case "note_read":
    case "note_save":
    case "note_delete":
      return JSON.stringify(await executeNoteTool(name, args));
    case "clipping_list":
    case "clipping_create":
    case "clipping_update":
    case "clipping_delete":
      return JSON.stringify(await executeClippingTool(name, args));
    default:
      return JSON.stringify({ error: `Unknown assistant tool: ${name}` });
  }
}

export function registerAssistantToolsHandlers(): void {
  ipcMain.handle("tasks:list", () => listTasks());
  ipcMain.handle("tasks:create", (_e, title: string, tags?: string[], status?: TaskStatus) =>
    createTask({ title, tags, status }),
  );
  ipcMain.handle(
    "tasks:update",
    (_e, payload: {
      id: string;
      title?: string;
      status?: TaskStatus;
      tags?: string[];
      add_tags?: string[];
      remove_tags?: string[];
    }) => updateTask(payload as Record<string, unknown>),
  );
  ipcMain.handle(
    "tasks:delete",
    (_e, id: string) =>
      deleteTask({ id })
  );
  ipcMain.handle("tasks:clearCompleted", () => clearCompletedTasks());
}
