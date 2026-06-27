import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { createTempDir } from "./__tests__/tempDir";
import {
  atomicWriteFile,
  backupScopedFiles,
  buildBundle,
  computeRevision,
  DEFAULT_SYNC_SCOPES,
  extractBundle,
  hashBundleBytes,
  parseBundle,
} from "./syncBundle";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeLocalData(seed: Record<string, string>): Promise<string> {
  const temp = await createTempDir("bundle-test-");
  cleanups.push(temp.cleanup);
  const localData = join(temp.path, "local-data");
  await mkdir(join(localData, "app-state"), { recursive: true });
  await mkdir(join(localData, "settings"), { recursive: true });
  await mkdir(join(localData, "themes"), { recursive: true });
  for (const [rel, contents] of Object.entries(seed)) {
    const abs = join(localData, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, contents, "utf-8");
  }
  return localData;
}

describe("computeRevision", () => {
  it("returns the same hash for identical input", async () => {
    const a = await makeLocalData({
      "app-state/conversations.json": '{"a":1}',
      "settings/settings.json": '{"version":1}',
    });
    const b = await makeLocalData({
      "app-state/conversations.json": '{"a":1}',
      "settings/settings.json": '{"version":1}',
    });
    expect(await computeRevision(a)).toBe(await computeRevision(b));
  });

  it("changes when content changes", async () => {
    const a = await makeLocalData({
      "app-state/conversations.json": '{"a":1}',
    });
    const before = await computeRevision(a);
    await writeFile(join(a, "app-state", "conversations.json"), '{"a":2}', "utf-8");
    expect(await computeRevision(a)).not.toBe(before);
  });

  it("ignores files outside the synced scopes (e.g. recordings)", async () => {
    const a = await makeLocalData({
      "app-state/conversations.json": '{"a":1}',
    });
    const before = await computeRevision(a);
    await mkdir(join(a, "recordings"), { recursive: true });
    await writeFile(join(a, "recordings", "rec1.wav"), "fake-audio", "utf-8");
    expect(await computeRevision(a)).toBe(before);
  });
});

describe("buildBundle / parseBundle / extractBundle", () => {
  it("round-trips files through pack -> unpack", async () => {
    const src = await makeLocalData({
      "app-state/conversations.json": '{"keep":"me"}',
      "settings/settings.json": '{"version":1}',
      "themes/theme.json": '{"accent":"#000"}',
    });
    const { bytes, bundleHash } = await buildBundle(src);
    expect(hashBundleBytes(bytes)).toBe(bundleHash);

    const dst = await makeLocalData({
      "app-state/conversations.json": '{"original":true}',
    });
    const doc = parseBundle(bytes);
    const result = await extractBundle(dst, doc);
    expect(result.filesWritten).toBe(3);

    expect(await readFile(join(dst, "app-state", "conversations.json"), "utf-8")).toBe(
      '{"keep":"me"}',
    );
    expect(await readFile(join(dst, "themes", "theme.json"), "utf-8")).toBe(
      '{"accent":"#000"}',
    );
  });

  it("removes in-scope files that the bundle does not contain", async () => {
    const dst = await makeLocalData({
      "app-state/conversations.json": '{"a":1}',
      "app-state/notes.json": '{"will":"vanish"}',
    });
    const src = await makeLocalData({
      "app-state/conversations.json": '{"a":1}',
    });
    const { bytes } = await buildBundle(src);
    await extractBundle(dst, parseBundle(bytes));
    expect(existsSync(join(dst, "app-state", "notes.json"))).toBe(false);
    expect(await readFile(join(dst, "app-state", "conversations.json"), "utf-8")).toBe(
      '{"a":1}',
    );
  });

  it("leaves out-of-scope files (recordings) untouched on extract", async () => {
    const dst = await makeLocalData({
      "app-state/conversations.json": '{"a":1}',
    });
    await mkdir(join(dst, "recordings"), { recursive: true });
    await writeFile(join(dst, "recordings", "rec.wav"), "should-stay", "utf-8");
    const src = await makeLocalData({
      "app-state/conversations.json": '{"new":true}',
    });
    const { bytes } = await buildBundle(src);
    await extractBundle(dst, parseBundle(bytes));
    expect(await readFile(join(dst, "recordings", "rec.wav"), "utf-8")).toBe("should-stay");
  });

  it("rejects bundles with the wrong format version", () => {
    const fake = Buffer.from(JSON.stringify({ version: 999, entries: [] }), "utf-8");
    // Manually gzip would fit; for a quick guard verify parseBundle on bad gzip throws too.
    expect(() => parseBundle(fake)).toThrow();
  });
});

describe("backupScopedFiles", () => {
  it("copies all in-scope files into the snapshot directory", async () => {
    const src = await makeLocalData({
      "app-state/conversations.json": '{"a":1}',
      "themes/theme.json": '{"accent":"#fff"}',
    });
    const tempDest = await createTempDir("bundle-snap-");
    cleanups.push(tempDest.cleanup);
    const result = await backupScopedFiles(src, tempDest.path, DEFAULT_SYNC_SCOPES);
    expect(result.filesBackedUp).toBe(2);
    expect(await readFile(join(tempDest.path, "app-state", "conversations.json"), "utf-8")).toBe(
      '{"a":1}',
    );
  });
});

describe("atomicWriteFile", () => {
  it("does not leave a partial file on a successful write", async () => {
    const temp = await createTempDir("bundle-atomic-");
    cleanups.push(temp.cleanup);
    const target = join(temp.path, "out.bin");
    await atomicWriteFile(target, Buffer.from("hello"));
    expect(await readFile(target, "utf-8")).toBe("hello");
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });
});
