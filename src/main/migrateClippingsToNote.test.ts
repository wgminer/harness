import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { CLIPPINGS_NOTE_TITLE } from "../shared/writing";
import { migrateClippingsToNoteIn } from "./migrateClippingsToNote";
import { listNotesIn, readNoteIn } from "./writing";

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("migrateClippingsToNoteIn", () => {
  let tempDir: string;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a numbered-list Clippings note and archives clippings.json", async () => {
    tempDir = await createTempDir("clippings-migrate-");
    await writeFile(
      join(tempDir, "clippings.json"),
      JSON.stringify({
        clippings: [
          { id: "c1", kind: "text", content: "First quote", tags: ["quotes"], createdAt: 1, updatedAt: 1 },
          { id: "c2", kind: "text", content: "Second quote", tags: [], createdAt: 2, updatedAt: 2 },
        ],
      }),
      "utf-8",
    );

    await migrateClippingsToNoteIn(tempDir);

    const notes = await listNotesIn(tempDir);
    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe(CLIPPINGS_NOTE_TITLE);

    const note = await readNoteIn(tempDir, notes[0].id);
    expect(note?.content).toBe("# Clippings\n\n1. First quote #quotes\n2. Second quote\n");

    await expect(readFile(join(tempDir, "clippings.json.bak"), "utf-8")).resolves.toContain("First quote");
  });

  it("appends to an existing Clippings note", async () => {
    tempDir = await createTempDir("clippings-migrate-");
    const { createNoteIn } = await import("./writing");
    await createNoteIn(tempDir, CLIPPINGS_NOTE_TITLE, "# Clippings\n\n1. Existing item\n");
    await writeFile(
      join(tempDir, "clippings.json"),
      JSON.stringify({
        clippings: [{ id: "c1", kind: "text", content: "New item", tags: [], createdAt: 1, updatedAt: 1 }],
      }),
      "utf-8",
    );

    await migrateClippingsToNoteIn(tempDir);

    const notes = await listNotesIn(tempDir);
    const note = await readNoteIn(tempDir, notes[0].id);
    expect(note?.content).toBe("# Clippings\n\n1. Existing item\n2. New item\n");
  });
});
