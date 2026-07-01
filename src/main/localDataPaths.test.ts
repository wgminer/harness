import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { createTempDir } from "./__tests__/tempDir";

let currentUserDataDir = "/tmp";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => currentUserDataDir),
  },
}));

import {
  cleanupLegacyMemoryDir,
  getAppStateDir,
  getLegacyMemoryDir,
  getLocalDataSettingsPath,
} from "./localDataPaths";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("local-data-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("local data migration", () => {
  it("copies legacy memory/settings into local-data and removes themes on first access", async () => {
    const dir = await makeDir();
    currentUserDataDir = dir;

    const legacyMemory = join(dir, "memory");
    const legacyThemes = join(dir, "themes");
    await mkdir(legacyMemory, { recursive: true });
    await mkdir(legacyThemes, { recursive: true });
    await writeFile(join(legacyMemory, "conversations.json"), JSON.stringify({}), "utf-8");
    await writeFile(join(dir, "settings.json"), JSON.stringify({ openai: { apiKey: "k1" } }), "utf-8");
    await writeFile(join(legacyThemes, "theme.json"), JSON.stringify({ accent: "#ffffff" }), "utf-8");

    const appStateDir = getAppStateDir();
    const settingsPath = getLocalDataSettingsPath();

    expect(appStateDir).toBe(join(dir, "local-data", "app-state"));
    expect(JSON.parse(await readFile(join(appStateDir, "conversations.json"), "utf-8"))).toEqual({});
    expect(JSON.parse(await readFile(settingsPath, "utf-8"))).toMatchObject({ openai: { apiKey: "k1" } });
    await expect(readFile(join(dir, "local-data", "themes", "theme.json"), "utf-8")).rejects.toThrow();
    await expect(readFile(join(legacyThemes, "theme.json"), "utf-8")).rejects.toThrow();

    await rm(join(dir, "memory"), { recursive: true, force: true });
    getAppStateDir();
    expect(await readFile(join(appStateDir, "conversations.json"), "utf-8")).toBe("{}");
  });

  it("cleanupLegacyMemoryDir removes only legacy memory directory", async () => {
    const dir = await makeDir();
    currentUserDataDir = dir;

    const legacyMemory = getLegacyMemoryDir();
    await mkdir(legacyMemory, { recursive: true });
    await writeFile(join(legacyMemory, "conversations.json"), "{}", "utf-8");

    const appStateDir = getAppStateDir();
    const appStateSentinel = join(appStateDir, "do-not-delete.json");
    await writeFile(appStateSentinel, '{"ok":true}', "utf-8");

    const removed = cleanupLegacyMemoryDir();
    expect(removed).toBe(true);
    await expect(readFile(appStateSentinel, "utf-8")).resolves.toContain('"ok":true');
    await expect(readFile(join(legacyMemory, "conversations.json"), "utf-8")).rejects.toThrow();
  });
});
