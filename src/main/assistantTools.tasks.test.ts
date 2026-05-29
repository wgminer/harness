import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "./__tests__/tempDir";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => "/tmp") },
}));

import { applyTaskAction, loadTasksIn, saveTasksIn } from "./assistantTools";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("tasks-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("task reducer and persistence", () => {
  it("creates, updates status and tags, deletes tasks", () => {
    const created = applyTaskAction({ tasks: [] }, { kind: "create", args: { title: "Write tests" } }, 10, () => "t1");
    expect(created.error).toBeUndefined();
    expect(created.tasks[0]).toMatchObject({ id: "t1", status: "pending", tags: [] });

    const updated = applyTaskAction(
      { tasks: created.tasks },
      { kind: "update", args: { id: "t1", status: "completed", add_tags: ["ci"] } },
      20,
    );
    expect(updated.tasks[0]).toMatchObject({ status: "completed", tags: ["ci"] });

    const deleted = applyTaskAction({ tasks: updated.tasks }, { kind: "delete", args: { id: "t1" } }, 30);
    expect(deleted.tasks).toEqual([]);
  });

  it("clear_completed preserves active tasks", () => {
    const state = {
      tasks: [
        { id: "a", title: "Done", status: "completed" as const, tags: [], createdAt: 1, updatedAt: 1 },
        { id: "b", title: "In progress", status: "in_progress" as const, tags: [], createdAt: 1, updatedAt: 1 },
        { id: "c", title: "Cancelled", status: "cancelled" as const, tags: [], createdAt: 1, updatedAt: 1 },
      ],
    };
    const cleared = applyTaskAction(state, { kind: "clear_completed" }, 2);
    expect(cleared.affectedIds).toEqual(["a", "c"]);
    expect(cleared.tasks.map((t) => t.id)).toEqual(["b"]);
  });

  it("migrates legacy status-in-tags when loading", async () => {
    const dir = await makeDir();
    await saveTasksIn(dir, {
      tasks: [{ id: "x", title: "Legacy", tags: ["pending", "work"], createdAt: 1, updatedAt: 1 }],
    });
    const loaded = await loadTasksIn(dir);
    expect(loaded.tasks).toHaveLength(1);
    expect(loaded.tasks[0]).toMatchObject({ status: "pending", tags: ["work"] });
  });
});
