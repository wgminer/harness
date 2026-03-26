import { ipcMain } from "electron";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { getUserMemory, setUserMemory, searchConversations, getMemoryDir, TASKS_FILE } from "./memory";
import { generateId } from "./utils";
import type { SearchResult } from "../shared/types";

type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
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

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function loadTasks(): Promise<TaskState> {
  const path = getTasksFilePath();
  if (!(await fileExists(path))) return { tasks: [] };
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.tasks)) {
      return { tasks: parsed.tasks as TaskItem[] };
    }
    if (Array.isArray(parsed)) {
      return { tasks: parsed as TaskItem[] };
    }
  } catch {
    // If the file is corrupt, start fresh
  }
  return { tasks: [] };
}

async function saveTasks(state: TaskState): Promise<void> {
  await writeFile(getTasksFilePath(), JSON.stringify({ tasks: state.tasks }, null, 2), "utf-8");
}

export async function listTasks(): Promise<TasksPayload> {
  const state = await loadTasks();
  return { ...state, lastAction: "list" };
}

export async function createTask(args: Record<string, unknown>): Promise<TasksPayload> {
  const title = String(args.title ?? "").trim();
  const rawStatus = String(args.status ?? "pending").trim() as TaskStatus;
  const metadata = (args.metadata && typeof args.metadata === "object" ? (args.metadata as Record<string, unknown>) : undefined) ?? undefined;

  if (!title) {
    const state = await loadTasks();
    return {
      ...state,
      lastAction: "create",
      error: "Task title is required",
    };
  }

  const now = Date.now();
  const state = await loadTasks();
  const status: TaskStatus =
    rawStatus === "pending" ||
    rawStatus === "in_progress" ||
    rawStatus === "completed" ||
    rawStatus === "cancelled"
      ? rawStatus
      : "pending";

  const task: TaskItem = {
    id: generateId("task"),
    title,
    status,
    createdAt: now,
    updatedAt: now,
    ...(metadata ? { metadata } : {}),
  };

  state.tasks.push(task);
  await saveTasks(state);

  return {
    ...state,
    lastAction: "create",
    affectedIds: [task.id],
  };
}

export async function updateTask(args: Record<string, unknown>): Promise<TasksPayload> {
  const id = String(args.id ?? "").trim();
  if (!id) {
    const state = await loadTasks();
    return {
      ...state,
      lastAction: "update",
      error: "Task id is required",
    };
  }

  const state = await loadTasks();
  const idx = state.tasks.findIndex((t) => t.id === id);
  if (idx === -1) {
    return {
      ...state,
      lastAction: "update",
      error: `Task not found: ${id}`,
    };
  }

  const existing = state.tasks[idx];
  const next: TaskItem = { ...existing, updatedAt: Date.now() };

  if (typeof args.title === "string") {
    const title = args.title.trim();
    if (title) next.title = title;
  }

  if (typeof args.status === "string") {
    const s = args.status.trim() as TaskStatus;
    if (s === "pending" || s === "in_progress" || s === "completed" || s === "cancelled") {
      next.status = s;
    }
  }

  if (args.metadata && typeof args.metadata === "object") {
    const metaPatch = args.metadata as Record<string, unknown>;
    next.metadata = { ...(next.metadata ?? {}), ...metaPatch };
  }

  state.tasks[idx] = next;
  await saveTasks(state);

  return {
    ...state,
    lastAction: "update",
    affectedIds: [id],
  };
}

export async function deleteTask(args: Record<string, unknown>): Promise<TasksPayload> {
  const id = String(args.id ?? "").trim();
  if (!id) {
    const state = await loadTasks();
    return {
      ...state,
      lastAction: "delete",
      error: "Task id is required",
    };
  }

  const state = await loadTasks();
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  const after = state.tasks.length;

  if (before === after) {
    return {
      ...state,
      lastAction: "delete",
      error: `Task not found: ${id}`,
    };
  }

  await saveTasks(state);

  return {
    ...state,
    lastAction: "delete",
    affectedIds: [id],
  };
}

export async function clearCompletedTasks(): Promise<TasksPayload> {
  const state = await loadTasks();
  const remaining: TaskItem[] = [];
  const removedIds: string[] = [];
  for (const t of state.tasks) {
    if (t.status === "completed" || t.status === "cancelled") {
      removedIds.push(t.id);
    } else {
      remaining.push(t);
    }
  }
  state.tasks = remaining;
  await saveTasks(state);
  return {
    ...state,
    lastAction: "clear_completed",
    affectedIds: removedIds,
  };
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
    default:
      return JSON.stringify({ error: `Unknown assistant tool: ${name}` });
  }
}

export function registerAssistantToolsHandlers(): void {
  ipcMain.handle("tasks:list", () => listTasks());
  ipcMain.handle(
    "tasks:create",
    (_e, title: string, status?: string) =>
      createTask({ title, status })
  );
  ipcMain.handle(
    "tasks:update",
    (_e, payload: { id: string; title?: string; status?: string }) =>
      updateTask(payload as Record<string, unknown>)
  );
  ipcMain.handle(
    "tasks:delete",
    (_e, id: string) =>
      deleteTask({ id })
  );
  ipcMain.handle("tasks:clearCompleted", () => clearCompletedTasks());
}
