import { afterEach, describe, expect, it } from "vitest";
import { createTempDir } from "./__tests__/tempDir";
import {
  createNoteIn,
  deleteNoteIn,
  listNotesIn,
  normalizeContent,
  readNoteIn,
  saveNoteIn,
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
  it("starts with empty notes list when storage is missing", async () => {
    const dir = await makeDir();
    await expect(listNotesIn(dir)).resolves.toEqual([]);
  });

  it("creates and saves a note while normalizing line endings", async () => {
    const dir = await makeDir();
    const note = await createNoteIn(dir, "Quick draft");
    const saved = await saveNoteIn(dir, note.id, "a\r\nb\rc");
    expect(saved.content).toBe("a\nb\nc");
    expect(normalizeContent("x\r\ny")).toBe("x\ny");
    const readBack = await readNoteIn(dir, note.id);
    expect(readBack).not.toBeNull();
    expect(readBack?.content).toBe("a\nb\nc");
  });

  it("lists notes in descending updated order", async () => {
    const dir = await makeDir();
    const older = await createNoteIn(dir, "Older");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = await createNoteIn(dir, "Newer");
    const list = await listNotesIn(dir);
    expect(list[0].id).toBe(newer.id);
    expect(list[1].id).toBe(older.id);
  });

  it("deletes notes and ignores missing ids", async () => {
    const dir = await makeDir();
    const one = await createNoteIn(dir, "One");
    await createNoteIn(dir, "Two");
    const next = await deleteNoteIn(dir, one.id);
    expect(next.some((n) => n.id === one.id)).toBe(false);
    const same = await deleteNoteIn(dir, "missing-id");
    expect(same.length).toBe(next.length);
  });

  it("migrates legacy writing.md into initial note", async () => {
    const dir = await makeDir();
    await writeFile(join(dir, "writing.md"), "# Legacy\nhello", "utf-8");
    const notes = await listNotesIn(dir);
    expect(notes.length).toBe(1);
    const legacy = await readNoteIn(dir, notes[0].id);
    expect(legacy?.content).toContain("hello");
  });
});
