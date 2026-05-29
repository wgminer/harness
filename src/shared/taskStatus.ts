import { normalizeTags } from "./tags";

export const TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const STATUS_SET = new Set<string>(TASK_STATUSES);

/** Workflow labels that used to live in tags — never treat as filter tags. */
export const WORKFLOW_STATUS_TAGS = STATUS_SET;

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

export function normalizeTaskStatus(input: unknown): TaskStatus | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase().replace(/\s+/g, "_");
  return isTaskStatus(s) ? s : null;
}

const STATUS_PRIORITY: TaskStatus[] = ["completed", "cancelled", "in_progress", "pending"];

function statusFromTagList(tags: string[]): TaskStatus | null {
  for (const s of STATUS_PRIORITY) {
    if (tags.includes(s)) return s;
  }
  return null;
}

/** Split persisted task rows into workflow status and user filter tags. */
export function migrateTaskFields(record: Record<string, unknown>): {
  status: TaskStatus;
  tags: string[];
} {
  const rawTags = normalizeTags(record.tags);
  const statusTags = rawTags.filter((t) => WORKFLOW_STATUS_TAGS.has(t));
  const labelTags = rawTags.filter((t) => !WORKFLOW_STATUS_TAGS.has(t));

  const fromField = normalizeTaskStatus(record.status);
  const fromTags = statusFromTagList(statusTags);
  // Legacy rows often stored workflow only in tags; prefer that over a stale status field.
  const status = fromTags ?? fromField ?? "pending";

  return { status, tags: labelTags };
}

/** Resolve workflow status for UI and filtering (handles legacy rows missing status). */
export function resolveTaskStatus(task: { status?: unknown; tags?: unknown }): TaskStatus {
  if (isTaskStatus(task.status) && !normalizeTags(task.tags).some((t) => WORKFLOW_STATUS_TAGS.has(t))) {
    return task.status;
  }
  return migrateTaskFields({
    status: task.status,
    tags: task.tags,
  }).status;
}

/** Open work — pending or in progress. */
export function taskIsActive(status: TaskStatus): boolean {
  return status === "pending" || status === "in_progress";
}

/** Finished work — completed or cancelled (Completed section). */
export function taskIsInCompletedSection(status: TaskStatus): boolean {
  return taskIsClearable(status);
}

export function taskNeedsStatusMigration(record: Record<string, unknown>): boolean {
  if (!isTaskStatus(record.status)) return true;
  const rawTags = normalizeTags(record.tags);
  return rawTags.some((t) => WORKFLOW_STATUS_TAGS.has(t));
}

export function taskIsDone(status: TaskStatus): boolean {
  return status === "completed";
}

export function taskIsClearable(status: TaskStatus): boolean {
  return status === "completed" || status === "cancelled";
}

export function toggleTaskCompleted(status: TaskStatus): TaskStatus {
  return status === "completed" ? "pending" : "completed";
}
