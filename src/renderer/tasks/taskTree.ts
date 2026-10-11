import type { TaskItem } from "../../shared/desktopAPI";
import { normalizeTags } from "../../shared/tags";
import { resolveTaskStatus, taskIsInCompletedSection } from "../../shared/taskStatus";

/** "Now" is a short focus list; everything else open is the backlog. */
export const NOW_LIMIT = 3;

export type TaskSectionId = "now" | "active" | "completed";

export interface TaskTree {
  now: TaskItem[];
  active: TaskItem[];
  completed: TaskItem[];
  /** Subtasks by parent id, oldest first (the order they were broken down in). */
  children: Map<string, TaskItem[]>;
}

/** A task with no parent, or whose parent no longer exists, is top level. */
export function topLevelParentId(task: TaskItem, ids: Set<string>): string | null {
  return task.parentId && ids.has(task.parentId) ? task.parentId : null;
}

export function sectionOf(task: TaskItem): TaskSectionId {
  const status = resolveTaskStatus(task);
  if (taskIsInCompletedSection(status)) return "completed";
  return status === "in_progress" ? "now" : "active";
}

function matches(task: TaskItem, q: string, tagQuery: string): boolean {
  return (
    task.title.toLowerCase().includes(q) ||
    normalizeTags(task.tags).some((tag) => tag.includes(tagQuery))
  );
}

/**
 * Split top-level tasks into Now / Active / Completed and index subtasks under their parent.
 * Subtasks stay with their parent whatever their own status. With a query, a parent is kept
 * when it or any of its subtasks matches, and keeps all of its subtasks.
 */
export function buildTaskTree(tasks: TaskItem[], query = ""): TaskTree {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string, TaskItem[]>();
  const top: TaskItem[] = [];
  for (const task of tasks) {
    const parentId = topLevelParentId(task, ids);
    if (parentId) {
      const list = children.get(parentId) ?? [];
      list.push(task);
      children.set(parentId, list);
    } else {
      top.push(task);
    }
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  }

  const q = query.trim().toLowerCase();
  const tagQuery = q.replace(/\s+/g, "_");
  const visible = q
    ? top.filter(
        (t) => matches(t, q, tagQuery) || (children.get(t.id) ?? []).some((c) => matches(c, q, tagQuery)),
      )
    : top;

  const tree: TaskTree = { now: [], active: [], completed: [], children };
  for (const task of visible) tree[sectionOf(task)].push(task);
  return tree;
}
