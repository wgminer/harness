import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "./__tests__/tempDir";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => "/tmp") },
}));

import { applyClippingAction, loadClippingsIn, saveClippingsIn } from "./clippings";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("clippings-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("clipping reducer and persistence", () => {
  it("creates, updates, deletes clippings with normalized tags", () => {
    const created = applyClippingAction(
      { clippings: [] },
      { kind: "create", args: { content: "Hello world", tags: ["Research", "research"] } },
      10,
      () => "c1",
    );
    expect(created.error).toBeUndefined();
    expect(created.clippings[0].id).toBe("c1");
    expect(created.clippings[0].tags).toEqual(["research"]);

    const updated = applyClippingAction(
      { clippings: created.clippings },
      { kind: "update", args: { id: "c1", content: "Updated", tags: ["quotes"] } },
      20,
    );
    expect(updated.clippings[0].content).toBe("Updated");
    expect(updated.clippings[0].tags).toEqual(["quotes"]);

    const patched = applyClippingAction(
      { clippings: updated.clippings },
      { kind: "update", args: { id: "c1", add_tags: ["draft"], remove_tags: ["quotes"] } },
      25,
    );
    expect(patched.clippings[0].tags).toEqual(["draft"]);

    const deleted = applyClippingAction(
      { clippings: updated.clippings },
      { kind: "delete", args: { id: "c1" } },
      30,
    );
    expect(deleted.clippings).toEqual([]);
  });

  it("filters list by tag", () => {
    const state = {
      clippings: [
        {
          id: "a",
          kind: "text" as const,
          content: "One",
          tags: ["alpha"],
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "b",
          kind: "text" as const,
          content: "Two",
          tags: ["beta"],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    };
    const listed = applyClippingAction(state, { kind: "list", args: { tag: "alpha" } });
    expect(listed.clippings.map((c) => c.id)).toEqual(["a"]);
  });

  it("rejects unsupported kinds", () => {
    const created = applyClippingAction(
      { clippings: [] },
      { kind: "create", args: { content: "https://example.com", kind: "url" } },
      10,
    );
    expect(created.error).toContain("not supported");
  });

  it("loads from disk and recovers from corrupt files", async () => {
    const dir = await makeDir();
    await saveClippingsIn(dir, {
      clippings: [
        {
          id: "x",
          kind: "text",
          content: "Saved",
          tags: ["note"],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    const loaded = await loadClippingsIn(dir);
    expect(loaded.clippings).toHaveLength(1);
    expect(loaded.clippings[0].content).toBe("Saved");
  });
});
