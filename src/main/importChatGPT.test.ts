import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempDir } from "./__tests__/tempDir";
import { loadSharedConversations, parseChatGPTConversation, parseChatGPTFile } from "./importChatGPT";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("import-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("importChatGPT parsing", () => {
  it("prefers current_node linear path", () => {
    const parsed = parseChatGPTConversation({
      id: "c1",
      title: "T",
      current_node: "n3",
      mapping: {
        n1: { parent: null, children: ["n2"], message: { author: { role: "user" }, content: { parts: ["hi"] } } },
        n2: { parent: "n1", children: ["n3"], message: { author: { role: "assistant" }, content: { parts: ["hello"] } } },
        n3: { parent: "n2", children: ["n4"], message: { author: { role: "user" }, content: { parts: ["latest"] } } },
        n4: { parent: "n3", children: [], message: { author: { role: "assistant" }, content: { parts: ["ignored branch"] } } },
      },
    });
    expect(parsed?.messages.map((m) => m.content)).toEqual(["hi", "hello", "latest"]);
  });

  it("parses file arrays and skips invalid json", () => {
    const rows = parseChatGPTFile('[{"id":"x","mapping":{}}, {"id":"y","mapping":{}}]');
    expect(rows.map((r) => r.id)).toEqual(["x", "y"]);
    expect(parseChatGPTFile("{not-json")).toEqual([]);
  });

  it("loads shared conversation order map", async () => {
    const dir = await makeDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "shared_conversations.json"),
      JSON.stringify([
        { conversation_id: "a", title: "First" },
        { conversation_id: "b", title: "Second" },
      ]),
      "utf-8"
    );
    const map = loadSharedConversations(dir);
    expect(map.get("a")).toEqual({ title: "First", orderIndex: 0 });
    expect(map.get("b")?.orderIndex).toBe(1);
  });
});
