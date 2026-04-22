import { afterEach, describe, expect, it } from "vitest";
import { MAX_WRITING_CHECKPOINTS } from "../shared/writing";
import { createTempDir } from "./__tests__/tempDir";
import {
  appendDocIn,
  createCheckpointIn,
  deleteCheckpointIn,
  listCheckpointsIn,
  normalizeContent,
  readDocIn,
  writeDocIn,
} from "./writing";
import { writeFile } from "fs/promises";
import { join } from "path";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("writing-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("writing surface", () => {
  it("returns empty snapshot when file is missing", async () => {
    const dir = await makeDir();
    await expect(readDocIn(dir)).resolves.toEqual({ content: "", updatedAt: 0 });
  });

  it("writes and normalizes line endings", async () => {
    const dir = await makeDir();
    const snapshot = await writeDocIn(dir, "a\r\nb\rc");
    expect(snapshot.content).toBe("a\nb\nc");
    expect(normalizeContent("x\r\ny")).toBe("x\ny");
    const readBack = await readDocIn(dir);
    expect(readBack.content).toBe("a\nb\nc");
  });

  it("appendDocIn inserts a paragraph separator when needed", async () => {
    const dir = await makeDir();
    await writeDocIn(dir, "hello");
    const appended = await appendDocIn(dir, "world");
    expect(appended.content).toBe("hello\n\nworld");
    const unchanged = await appendDocIn(dir, "");
    expect(unchanged.content).toBe("hello\n\nworld");
  });

  it("maintains checkpoint cap and delete behavior", async () => {
    const dir = await makeDir();
    for (let i = 0; i < MAX_WRITING_CHECKPOINTS + 4; i++) {
      await createCheckpointIn(dir, `cp-${i}`);
    }
    const all = await listCheckpointsIn(dir);
    expect(all.length).toBe(MAX_WRITING_CHECKPOINTS);
    expect(all[0].createdAt).toBeGreaterThanOrEqual(all[1].createdAt);

    const next = await deleteCheckpointIn(dir, all[0].id);
    expect(next.some((cp) => cp.id === all[0].id)).toBe(false);
    const same = await deleteCheckpointIn(dir, "missing-id");
    expect(same.length).toBe(next.length);
  });

  it("tolerates corrupt checkpoint file", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "writing-checkpoints.json"), "{invalid-json", "utf-8");
    await expect(listCheckpointsIn(dir)).resolves.toEqual([]);
  });
});
