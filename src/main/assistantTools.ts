import { app, ipcMain } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getUserMemory, setUserMemory, searchConversations } from "./memory";
import type { SearchResult } from "../shared/types";

const MEMORY_DIR = "memory";
const TASKS_FILE = "tasks.json";

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

function getMemoryDir(): string {
  const dir = join(app.getPath("userData"), MEMORY_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getTasksFilePath(): string {
  return join(getMemoryDir(), TASKS_FILE);
}

function loadTasks(): TaskState {
  const path = getTasksFilePath();
  if (!existsSync(path)) return { tasks: [] };
  try {
    const raw = readFileSync(path, "utf-8");
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

function saveTasks(state: TaskState): void {
  const path = getTasksFilePath();
  writeFileSync(path, JSON.stringify({ tasks: state.tasks }, null, 2), "utf-8");
}

export function listTasks(): TasksPayload {
  const state = loadTasks();
  return { ...state, lastAction: "list" };
}

export function createTask(args: Record<string, unknown>): TasksPayload {
  const title = String(args.title ?? "").trim();
  const rawStatus = String(args.status ?? "pending").trim() as TaskStatus;
  const metadata = (args.metadata && typeof args.metadata === "object" ? (args.metadata as Record<string, unknown>) : undefined) ?? undefined;

  if (!title) {
    const state = loadTasks();
    return {
      ...state,
      lastAction: "create",
      error: "Task title is required",
    };
  }

  const now = Date.now();
  const state = loadTasks();
  const status: TaskStatus =
    rawStatus === "pending" ||
    rawStatus === "in_progress" ||
    rawStatus === "completed" ||
    rawStatus === "cancelled"
      ? rawStatus
      : "pending";

  const task: TaskItem = {
    id: `task_${now}_${Math.random().toString(36).slice(2, 8)}`,
    title,
    status,
    createdAt: now,
    updatedAt: now,
    ...(metadata ? { metadata } : {}),
  };

  state.tasks.push(task);
  saveTasks(state);

  return {
    ...state,
    lastAction: "create",
    affectedIds: [task.id],
  };
}

export function updateTask(args: Record<string, unknown>): TasksPayload {
  const id = String(args.id ?? "").trim();
  if (!id) {
    const state = loadTasks();
    return {
      ...state,
      lastAction: "update",
      error: "Task id is required",
    };
  }

  const state = loadTasks();
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
  saveTasks(state);

  return {
    ...state,
    lastAction: "update",
    affectedIds: [id],
  };
}

export function deleteTask(args: Record<string, unknown>): TasksPayload {
  const id = String(args.id ?? "").trim();
  if (!id) {
    const state = loadTasks();
    return {
      ...state,
      lastAction: "delete",
      error: "Task id is required",
    };
  }

  const state = loadTasks();
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

  saveTasks(state);

  return {
    ...state,
    lastAction: "delete",
    affectedIds: [id],
  };
}

export function clearCompletedTasks(): TasksPayload {
  const state = loadTasks();
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
  saveTasks(state);
  return {
    ...state,
    lastAction: "clear_completed",
    affectedIds: removedIds,
  };
}

function setMemoryFact(args: Record<string, unknown>): MemoryFactsPayload {
  const key = String(args.key ?? "").trim();
  const value = String(args.value ?? "").trim();

  if (!key) {
    const current = getUserMemory();
    return {
      lastAction: "set_fact",
      memory: current,
      key,
    };
  }

  setUserMemory(key, value);
  const memory = getUserMemory();
  return {
    lastAction: "set_fact",
    memory,
    key,
  };
}

function listMemoryFacts(): MemoryFactsPayload {
  const memory = getUserMemory();
  return {
    lastAction: "list_facts",
    memory,
  };
}

function searchMemoryConversations(args: Record<string, unknown>): MemorySearchPayload {
  const query = String(args.query ?? "").trim();
  const results = query ? searchConversations(query) : [];
  return {
    lastAction: "search_conversations",
    query,
    results,
  };
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
  ].includes(name);
}

export function executeAssistantTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "task_list":
      return JSON.stringify(listTasks());
    case "task_create":
      return JSON.stringify(createTask(args));
    case "task_update":
      return JSON.stringify(updateTask(args));
    case "task_delete":
      return JSON.stringify(deleteTask(args));
    case "task_clear_completed":
      return JSON.stringify(clearCompletedTasks());
    case "memory_set_fact":
      return JSON.stringify(setMemoryFact(args));
    case "memory_list_facts":
      return JSON.stringify(listMemoryFacts());
    case "memory_search_conversations":
      return JSON.stringify(searchMemoryConversations(args));
    default:
      return JSON.stringify({ error: `Unknown assistant tool: ${name}` });
  }
}

export function registerAssistantToolsHandlers(): void {
  ipcMain.handle("tasks:list", (): TasksPayload => listTasks());
  ipcMain.handle(
    "tasks:create",
    (_e, title: string, status?: string): TasksPayload =>
      createTask({ title, status })
  );
  ipcMain.handle(
    "tasks:update",
    (_e, payload: { id: string; title?: string; status?: string }): TasksPayload =>
      updateTask(payload as Record<string, unknown>)
  );
  ipcMain.handle(
    "tasks:delete",
    (_e, id: string): TasksPayload =>
      deleteTask({ id })
  );
  ipcMain.handle("tasks:clearCompleted", (): TasksPayload => clearCompletedTasks());
}


