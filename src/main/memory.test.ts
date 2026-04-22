import { access, readFile } from "fs/promises";
import { constants } from "fs";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDir } from "./__tests__/tempDir";
import {
  appendMessageIn,
  createConversationIn,
  deleteConversationIn,
  extractSnippet,
  getConversationIn,
  getExistingChatgptIdsIn,
  getMessagesIn,
  getMessagesPathIn,
  importConversationsIn,
  listConversationsIn,
  popLastUserMessageIn,
  resetStoredDataIn,
  searchConversationsIn,
  setConversationTitleIn,
  setUserMemoryIn,
} from "./memory";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("memory-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("memory persistence", () => {
  it("creates/list/gets conversations in newest-first order", async () => {
    const dir = await makeDir();
    const first = await createConversationIn(dir);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createConversationIn(dir);

    const list = await listConversationsIn(dir);
    expect(list.map((c) => c.id)).toEqual([second, first]);

    const conv = await getConversationIn(dir, first);
    expect(conv?.id).toBe(first);
  });

  it("appends message metadata and supports popLastUserMessage", async () => {
    const dir = await makeDir();
    const id = await createConversationIn(dir);
    await appendMessageIn(dir, id, "user", "hi", {
      timestamp: 123,
      model: "gpt-x",
      toolCalls: [{ toolName: "task_list", payload: { ok: true } }],
    });
    await appendMessageIn(dir, id, "assistant", "hello");
    const none = await popLastUserMessageIn(dir, id);
    expect(none).toBeNull();
    await appendMessageIn(dir, id, "user", "tail");
    const popped = await popLastUserMessageIn(dir, id);
    expect(popped).toBe("tail");

    const rows = await getMessagesIn(dir, id);
    expect(rows[0]).toMatchObject({
      role: "user",
      content: "hi",
      timestamp: 123,
      model: "gpt-x",
    });
    expect(rows[0].toolCalls?.[0]?.toolName).toBe("task_list");
  });

  it("deletes conversation metadata and message file", async () => {
    const dir = await makeDir();
    const id = await createConversationIn(dir);
    await appendMessageIn(dir, id, "user", "to-be-removed");
    const path = getMessagesPathIn(dir, id);
    await access(path, constants.F_OK);
    await deleteConversationIn(dir, id);
    await expect(access(path, constants.F_OK)).rejects.toThrow();
    await deleteConversationIn(dir, id);
  });

  it("imports conversations and dedupes ChatGPT ids", async () => {
    const dir = await makeDir();
    await importConversationsIn(dir, [
      {
        title: "One",
        createdAt: 1,
        chatgptId: "chatgpt-1",
        messages: [{ role: "user", content: "hello" }],
      },
    ]);
    const existing = await getExistingChatgptIdsIn(dir);
    expect(existing).toContain("chatgpt-1");
  });

  it("searches by title and body with snippet ranges", async () => {
    const dir = await makeDir();
    const id = await createConversationIn(dir);
    await setConversationTitleIn(dir, id, "My Search Title");
    await appendMessageIn(dir, id, "user", "line1\nneedle appears here\nline3");

    const titleMatches = await searchConversationsIn(dir, "search");
    expect(titleMatches).toHaveLength(1);
    const bodyMatches = await searchConversationsIn(dir, "needle");
    expect(bodyMatches[0].snippet.toLowerCase()).toContain("needle");
    expect(bodyMatches[0].snippetMatchRange[0]).toBeGreaterThanOrEqual(0);

    const noMatches = await searchConversationsIn(dir, "   ");
    expect(noMatches).toEqual([]);
  });

  it("extractSnippet returns clamped match range", () => {
    const extracted = extractSnippet("abc def ghi", "def", 4);
    expect(extracted.snippet).toContain("def");
    expect(extracted.snippetMatchRange).toEqual([4, 7]);
  });

  it("resetStoredData wipes memory, tasks, and plans files", async () => {
    const dir = await makeDir();
    const id = await createConversationIn(dir);
    await appendMessageIn(dir, id, "user", "hello");
    await setUserMemoryIn(dir, "name", "Harness");
    await readFile(getMessagesPathIn(dir, id), "utf-8");
    await resetStoredDataIn(dir);

    expect(await listConversationsIn(dir)).toEqual([]);
    expect(await searchConversationsIn(dir, "hello")).toEqual([]);
  });
});
