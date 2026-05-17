import { afterEach, describe, expect, it } from "vitest";
import {
  appendMessageIn,
  createConversationIn,
  getUserMemoryIn,
  setConversationTitleIn,
  setUserMemoryIn,
} from "./memory";
import { createTempDir } from "./__tests__/tempDir";
import {
  buildTranscript,
  compileMemoriesIn,
  EMPTY_COMPILE_STATE,
  isCompileDue,
  loadCompileStateIn,
  localDateString,
  MEMORY_COMPILE_CHAR_BUDGET,
  mergeFacts,
  saveCompileStateIn,
  type DistilledFact,
  type MemoryCompileLLM,
} from "./memoryCompile";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("memcompile-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

function fakeLLM(facts: DistilledFact[], capture?: { lastInput?: string }): MemoryCompileLLM {
  return {
    async distill(transcripts: string): Promise<DistilledFact[]> {
      if (capture) capture.lastInput = transcripts;
      return facts;
    },
  };
}

describe("memoryCompile schedule", () => {
  it("isCompileDue returns true when no prior run, false when same local date", () => {
    const now = new Date(2026, 4, 17, 9, 0, 0);
    expect(isCompileDue(EMPTY_COMPILE_STATE, now)).toBe(true);
    const ranToday = { ...EMPTY_COMPILE_STATE, lastRunDateLocal: localDateString(now) };
    expect(isCompileDue(ranToday, now)).toBe(false);
    const ranYesterday = { ...EMPTY_COMPILE_STATE, lastRunDateLocal: "2026-05-16" };
    expect(isCompileDue(ranYesterday, now)).toBe(true);
  });

  it("loadCompileStateIn returns empty defaults when no file exists", async () => {
    const dir = await makeDir();
    const state = await loadCompileStateIn(dir);
    expect(state).toEqual(EMPTY_COMPILE_STATE);
  });

  it("saveCompileStateIn round-trips through loadCompileStateIn", async () => {
    const dir = await makeDir();
    const state = {
      lastRunAt: 12345,
      lastRunDateLocal: "2026-05-17",
      lastAddedCount: 2,
      lastUpdatedCount: 1,
      lastConsideredCount: 5,
      lastError: null,
    };
    await saveCompileStateIn(dir, state);
    expect(await loadCompileStateIn(dir)).toEqual(state);
  });
});

describe("mergeFacts", () => {
  it("adds new keys and skips empty values", () => {
    const result = mergeFacts({}, [
      { key: "timezone", value: "America/New_York" },
      { key: "missing", value: "" },
      { key: "  ", value: "ignored" },
    ]);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.merged).toEqual({ timezone: "America/New_York" });
  });

  it("updates only when value materially differs (case-insensitive key match)", () => {
    const existing = { Timezone: "America/New_York", project: "harness" };
    const result = mergeFacts(existing, [
      { key: "timezone", value: "America/New_York" }, // unchanged
      { key: "PROJECT", value: "harness v2" }, // updated; preserves original key spelling
      { key: "editor", value: "Cursor" }, // added
    ]);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.merged.Timezone).toBe("America/New_York");
    expect(result.merged.project).toBe("harness v2");
    expect(result.merged.editor).toBe("Cursor");
  });

  it("dedupes same key appearing twice in the same response", () => {
    const result = mergeFacts({}, [
      { key: "stack", value: "TypeScript" },
      { key: "STACK", value: "TypeScript + React" },
    ]);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(0);
    expect(Object.values(result.merged)).toEqual(["TypeScript"]);
  });
});

describe("buildTranscript", () => {
  it("respects the per-run char budget and returns included slices", () => {
    const big = "x".repeat(MEMORY_COMPILE_CHAR_BUDGET);
    const slices = [
      { id: "a", createdAt: 1, title: "A", newestMessageAt: 3, userText: big },
      { id: "b", createdAt: 2, title: "B", newestMessageAt: 4, userText: "second one" },
    ];
    const { transcript, included } = buildTranscript(slices);
    expect(included.map((s) => s.id)).toEqual(["a"]);
    expect(transcript).toContain("Conversation 1: A");
    expect(transcript).not.toContain("second one");
  });
});

describe("compileMemoriesIn", () => {
  it("scopes to conversations updated since the last run, and merges into user memory", async () => {
    const dir = await makeDir();

    // Prior run at T0; only conversations with newer activity should be considered.
    const t0 = Date.UTC(2026, 4, 16, 0, 0, 0);
    await saveCompileStateIn(dir, {
      ...EMPTY_COMPILE_STATE,
      lastRunAt: t0,
      lastRunDateLocal: "2026-05-16",
    });

    const oldId = await createConversationIn(dir);
    await setConversationTitleIn(dir, oldId, "Old", "user");
    await appendMessageIn(dir, oldId, "user", "I live in Boston", { timestamp: t0 - 10_000 });

    const newId = await createConversationIn(dir);
    await setConversationTitleIn(dir, newId, "New", "user");
    await appendMessageIn(dir, newId, "user", "I switched timezone to America/New_York", {
      timestamp: t0 + 10_000,
    });
    await appendMessageIn(dir, newId, "assistant", "Got it.", { timestamp: t0 + 11_000 });

    const capture: { lastInput?: string } = {};
    const llm = fakeLLM(
      [
        { key: "timezone", value: "America/New_York" },
        { key: "primary_project", value: "Harness desktop app" },
      ],
      capture
    );

    const compileNow = new Date(t0 + 30 * 60 * 60 * 1000);
    const result = await compileMemoriesIn(dir, llm, compileNow);

    expect(result.skipped).toBe(false);
    expect(result.considered).toBe(1);
    expect(result.added).toBe(2);
    expect(result.updated).toBe(0);

    // Only the new-conversation user text should reach the LLM.
    expect(capture.lastInput).toContain("America/New_York");
    expect(capture.lastInput).not.toContain("Boston");

    const memory = await getUserMemoryIn(dir);
    expect(memory.timezone).toBe("America/New_York");
    expect(memory.primary_project).toBe("Harness desktop app");

    const state = await loadCompileStateIn(dir);
    expect(state.lastRunAt).toBe(compileNow.getTime());
    expect(state.lastRunDateLocal).toBe(localDateString(compileNow));
    expect(state.lastAddedCount).toBe(2);
    expect(state.lastConsideredCount).toBe(1);
    expect(state.lastError).toBeNull();
  });

  it("merges with existing memory rather than overwriting unrelated keys", async () => {
    const dir = await makeDir();
    await setUserMemoryIn(dir, "name", "WGM");
    await setUserMemoryIn(dir, "timezone", "UTC");

    const t0 = Date.UTC(2026, 4, 16);
    await saveCompileStateIn(dir, {
      ...EMPTY_COMPILE_STATE,
      lastRunAt: t0,
      lastRunDateLocal: "2026-05-16",
    });

    const id = await createConversationIn(dir);
    await appendMessageIn(dir, id, "user", "moved to NYC", { timestamp: t0 + 1_000 });

    const llm = fakeLLM([
      { key: "timezone", value: "America/New_York" },
      { key: "city", value: "New York" },
    ]);
    const compileAt = new Date(t0 + 25 * 60 * 60 * 1000);
    const result = await compileMemoriesIn(dir, llm, compileAt);

    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    const memory = await getUserMemoryIn(dir);
    expect(memory.name).toBe("WGM");
    expect(memory.timezone).toBe("America/New_York");
    expect(memory.city).toBe("New York");
  });

  it("skips when no conversations have new activity", async () => {
    const dir = await makeDir();
    const t0 = Date.UTC(2026, 4, 16);
    await saveCompileStateIn(dir, {
      ...EMPTY_COMPILE_STATE,
      lastRunAt: t0,
      lastRunDateLocal: "2026-05-16",
    });

    const id = await createConversationIn(dir);
    await appendMessageIn(dir, id, "user", "older note", { timestamp: t0 - 60_000 });

    const llm = fakeLLM([{ key: "should_not_appear", value: "x" }]);
    const result = await compileMemoriesIn(dir, llm, new Date(t0 + 25 * 60 * 60 * 1000));

    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe("no-conversations");
    const memory = await getUserMemoryIn(dir);
    expect(memory).toEqual({});
    const state = await loadCompileStateIn(dir);
    expect(state.lastRunAt).toBeGreaterThan(t0);
    expect(state.lastConsideredCount).toBe(0);
  });

  it("first run (no prior state) looks back ~24h", async () => {
    const dir = await makeDir();
    const now = Date.UTC(2026, 4, 17, 12);

    const oldId = await createConversationIn(dir);
    await appendMessageIn(dir, oldId, "user", "ancient", { timestamp: now - 7 * 24 * 60 * 60 * 1000 });

    const recentId = await createConversationIn(dir);
    await appendMessageIn(dir, recentId, "user", "fresh fact", { timestamp: now - 60 * 60 * 1000 });

    const capture: { lastInput?: string } = {};
    const llm = fakeLLM([{ key: "stack", value: "TypeScript" }], capture);
    const result = await compileMemoriesIn(dir, llm, new Date(now));

    expect(result.skipped).toBe(false);
    expect(result.considered).toBe(1);
    expect(capture.lastInput).toContain("fresh fact");
    expect(capture.lastInput).not.toContain("ancient");
  });
});
