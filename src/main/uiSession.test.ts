import { readFile } from "fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDir } from "./__tests__/tempDir";
import { mergeUiSessionInDir, readUiSessionFromDir } from "./uiSession";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

describe("uiSession persistence", () => {
  it("merges partial updates on disk", async () => {
    const temp = await createTempDir("ui-session-test-");
    cleanups.push(temp.cleanup);

    mergeUiSessionInDir(temp.path, { view: "notes", notesOpenNoteId: "n1" });
    expect(readUiSessionFromDir(temp.path)).toEqual({
      view: "notes",
      conversationId: null,
      notesOpenNoteId: "n1",
    });

    mergeUiSessionInDir(temp.path, { view: "chat", conversationId: "c1" });
    expect(readUiSessionFromDir(temp.path)).toEqual({
      view: "chat",
      conversationId: "c1",
      notesOpenNoteId: "n1",
    });

    const raw = await readFile(`${temp.path}/ui-session.json`, "utf-8");
    expect(JSON.parse(raw)).toMatchObject({ view: "chat", conversationId: "c1" });
  });
});
