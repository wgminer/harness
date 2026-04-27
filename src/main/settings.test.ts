import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "./__tests__/tempDir";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => "/tmp") },
}));

import { DEFAULT_SETTINGS } from "../shared/types";
import { loadSettingsFromPath, parseSettings, saveSettingsToPath } from "./settings";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("settings-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("settings parsing", () => {
  it("fills missing fields from defaults", () => {
    const parsed = parseSettings({});
    expect(parsed).toEqual(DEFAULT_SETTINGS);
  });

  it("drops unknown keys and keeps nested cleanup defaults", () => {
    const parsed = parseSettings({
      openai: { apiKey: "abc" },
      transcription: {},
      extra: { nope: true },
    });
    expect(parsed.openai?.apiKey).toBe("abc");
    expect(parsed.transcription?.cleanup?.enabled).toBe(false);
    expect(parsed.notes?.templates.length).toBe(3);
    expect((parsed as Record<string, unknown>).extra).toBeUndefined();
  });

  it("round-trips via explicit path helpers", async () => {
    const dir = await makeDir();
    const path = join(dir, "settings.json");
    const next = { ...DEFAULT_SETTINGS, openai: { apiKey: "k1" } };
    await saveSettingsToPath(path, next);
    const loaded = await loadSettingsFromPath(path);
    expect(loaded.openai?.apiKey).toBe("k1");

    await writeFile(path, JSON.stringify({ transcription: { cleanup: { enabled: true } } }), "utf-8");
    const reparsed = await loadSettingsFromPath(path);
    expect(reparsed.transcription?.cleanup?.enabled).toBe(true);
    const raw = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    expect(raw.transcription).toBeDefined();
  });
});
