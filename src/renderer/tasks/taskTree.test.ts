import { describe, expect, it } from "vitest";
import type { TaskItem } from "../../shared/desktopAPI";
import { buildTaskTree } from "./taskTree";

function task(id: string, patch: Partial<TaskItem> = {}): TaskItem {
  return { id, title: id, status: "pending", tags: [], createdAt: 0, ...patch };
}

describe("buildTaskTree", () => {
  it("splits top-level tasks into now, active and completed", () => {
    const tree = buildTaskTree([
      task("a"),
      task("b", { status: "in_progress" }),
      task("c", { status: "completed" }),
      task("d", { status: "cancelled" }),
    ]);
    expect(tree.now.map((t) => t.id)).toEqual(["b"]);
    expect(tree.active.map((t) => t.id)).toEqual(["a"]);
    expect(tree.completed.map((t) => t.id)).toEqual(["c", "d"]);
  });

  it("keeps subtasks under their parent, oldest first, whatever their status", () => {
    const tree = buildTaskTree([
      task("p", { status: "in_progress" }),
      task("s2", { parentId: "p", createdAt: 2 }),
      task("s1", { parentId: "p", createdAt: 1, status: "completed" }),
    ]);
    expect(tree.now.map((t) => t.id)).toEqual(["p"]);
    expect(tree.completed).toEqual([]);
    expect(tree.children.get("p")?.map((t) => t.id)).toEqual(["s1", "s2"]);
  });

  it("treats a subtask with a missing parent as top level", () => {
    const tree = buildTaskTree([task("orphan", { parentId: "gone" })]);
    expect(tree.active.map((t) => t.id)).toEqual(["orphan"]);
  });

  it("keeps a parent when only a subtask matches the search", () => {
    const tree = buildTaskTree(
      [task("Plan trip"), task("Book flight", { parentId: "Plan trip" }), task("Laundry")],
      "flight",
    );
    expect(tree.active.map((t) => t.id)).toEqual(["Plan trip"]);
  });
});
