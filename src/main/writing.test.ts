import { afterEach, describe, expect, it } from "vitest";
import { createTempDir } from "./__tests__/tempDir";
import {
  buildNotesEditPrompt,
  buildNotesSpellCheckPrompt,
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

describe("notes storage", () => {
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

  it("strips markdown heading markers from derived note titles", async () => {
    const dir = await makeDir();
    const note = await createNoteIn(dir, undefined, "# Roadmap\n\nNext steps");
    expect(note.title).toBe("Roadmap");

    const saved = await saveNoteIn(dir, note.id, "## Updated plan\nMore text");
    expect(saved.title).toBe("Updated plan");
  });

  it("applies title and content template tokens during create", async () => {
    const dir = await makeDir();
    const note = await createNoteIn(dir, "Daily log {{today}}", "# {{today}}\n\nNotes");
    expect(note.title).not.toContain("{{today}}");
    expect(note.content).not.toContain("{{today}}");
  });

  it("uses template cursor marker for initial caret placement", async () => {
    const dir = await makeDir();
    const note = await createNoteIn(dir, "Cursor test", "# Title\n\n{{ @cursor }}Start here");
    expect(note.content).toBe("# Title\n\nStart here");
    expect(note.initialCursorOffset).toBe(9);
  });

  it("derives create-time title from content instead of template card title", async () => {
    const dir = await makeDir();
    const note = await createNoteIn(
      dir,
      "Template card title",
      "# Actual title from body\n\nBody text",
    );
    expect(note.title).toBe("Actual title from body");
  });
});

describe("buildNotesEditPrompt", () => {
  it("includes instruction, selected text, and surrounding context blocks", () => {
    const prompt = buildNotesEditPrompt({
      prompt: "Make this more concise.",
      selectedText: "selected",
      beforeText: "before",
      afterText: "after",
      documentText: "before selected after",
    });

    expect(prompt).toContain("[Instruction]\nMake this more concise.");
    expect(prompt).toContain("[TextBeforeSelection]\nbefore");
    expect(prompt).toContain("[SelectedText]\nselected");
    expect(prompt).toContain("[TextAfterSelection]\nafter");
    expect(prompt).toContain("[FullDocument]\nbefore selected after");
  });

  it("mentions concise-answer allowance for question-style prompts", () => {
    const prompt = buildNotesEditPrompt({
      prompt: "What does this sentence mean?",
      selectedText: "This sentence.",
      beforeText: "",
      afterText: "",
      documentText: "This sentence.",
    });

    expect(prompt).toContain("If the instruction is clearly a question about the selected text");
  });
});

describe("buildNotesSpellCheckPrompt", () => {
  it("includes selected text and surrounding context without a custom instruction", () => {
    const prompt = buildNotesSpellCheckPrompt({
      selectedText: "teh quick brown fox",
      beforeText: "Once upon a time, ",
      afterText: " jumped.",
      documentText: "Once upon a time, teh quick brown fox jumped.",
    });

    expect(prompt).toContain("Correct spelling and grammar in the selected text only.");
    expect(prompt).not.toContain("[Instruction]");
    expect(prompt).toContain("[TextBeforeSelection]\nOnce upon a time, ");
    expect(prompt).toContain("[SelectedText]\nteh quick brown fox");
    expect(prompt).toContain("[TextAfterSelection]\n jumped.");
    expect(prompt).toContain("Do not rewrite, rephrase, change tone");
  });
});
