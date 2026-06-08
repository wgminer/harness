import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { createTempDir } from "./__tests__/tempDir";
import {
  atomicWriteUtf8,
  jsonExtraDataEndIndex,
  parseJsonUtf8,
  readJsonArrayFile,
} from "./jsonFile";

describe("parseJsonUtf8", () => {
  it("parses valid JSON", () => {
    expect(parseJsonUtf8('{"a":1}')).toEqual({ value: { a: 1 }, repaired: false });
  });

  it("recovers when extra bytes follow a complete value", () => {
    const raw = '{"ok":true}\n": "auto"\n  }\n}';
    const result = parseJsonUtf8<Record<string, unknown>>(raw);
    expect(result.repaired).toBe(true);
    expect(result.value).toEqual({ ok: true });
  });

  it("extracts end index from Node extra-data syntax errors", () => {
    try {
      JSON.parse('{}x');
    } catch (err) {
      expect(jsonExtraDataEndIndex(err)).toBe(2);
    }
  });
});

describe("readJsonArrayFile", () => {
  it("returns [] for a missing file", async () => {
    const temp = await createTempDir("json-array-test-");
    expect(await readJsonArrayFile(join(temp.path, "nope.json"))).toEqual([]);
    await temp.cleanup();
  });

  it("returns [] for an empty file instead of throwing", async () => {
    const temp = await createTempDir("json-array-test-");
    const path = join(temp.path, "messages.json");
    await writeFile(path, "", "utf-8");
    expect(await readJsonArrayFile(path)).toEqual([]);
    await temp.cleanup();
  });

  it("reads a valid array", async () => {
    const temp = await createTempDir("json-array-test-");
    const path = join(temp.path, "messages.json");
    await writeFile(path, JSON.stringify([{ role: "user", content: "hi" }]), "utf-8");
    expect(await readJsonArrayFile(path)).toEqual([{ role: "user", content: "hi" }]);
    await temp.cleanup();
  });

  it("trims trailing garbage and rewrites a clean file", async () => {
    const temp = await createTempDir("json-array-test-");
    const path = join(temp.path, "messages.json");
    await writeFile(path, '[{"a":1}]trailing', "utf-8");
    expect(await readJsonArrayFile(path)).toEqual([{ a: 1 }]);
    expect(JSON.parse(await readFile(path, "utf-8"))).toEqual([{ a: 1 }]);
    await temp.cleanup();
  });

  it("backs up unrecoverable content and resets to []", async () => {
    const temp = await createTempDir("json-array-test-");
    const path = join(temp.path, "messages.json");
    await writeFile(path, "{ not json at all", "utf-8");
    expect(await readJsonArrayFile(path)).toEqual([]);
    expect(JSON.parse(await readFile(path, "utf-8"))).toEqual([]);
    await temp.cleanup();
  });
});

describe("atomicWriteUtf8", () => {
  it("survives concurrent writes to the same path", async () => {
    const temp = await createTempDir("json-file-test-");
    const path = join(temp.path, "conversations.json");
    await Promise.all(
      Array.from({ length: 24 }, (_, i) => atomicWriteUtf8(path, JSON.stringify({ n: i }))),
    );
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as { n: number };
    expect(parsed.n).toBeGreaterThanOrEqual(0);
    expect(parsed.n).toBeLessThan(24);
    await temp.cleanup();
  });
});
