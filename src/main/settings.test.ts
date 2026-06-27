import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "./__tests__/tempDir";

let userDataDir = "/tmp";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: {
    getPath: vi.fn(() => userDataDir),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s, "utf-8")),
    decryptString: vi.fn((b: Buffer) => b.toString("utf-8")),
  },
}));

import { DEFAULT_SETTINGS } from "../shared/types";
import { loadSettingsFromPath, parseSettings, saveSettingsToPath, setSettings } from "./settings";
import { getCredential } from "./credentials";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("settings-test-");
  userDataDir = temp.path;
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("settings parsing", () => {
  it("fills missing fields from defaults without loading secrets from disk", () => {
    const parsed = parseSettings({});
    expect(parsed.openai?.apiKey).toBe("");
    expect(parsed.search?.tavilyApiKey).toBe("");
    expect(parsed.sync?.prefix).toBe("harness/");
  });

  it("ignores api keys in raw json during parse", () => {
    const parsed = parseSettings({
      openai: { apiKey: "abc" },
      search: { tavilyApiKey: "tvly" },
    });
    expect(parsed.openai?.apiKey).toBe("");
    expect(parsed.search?.tavilyApiKey).toBe("");
  });

  it("migrates secrets from settings.json on load and clears the file", async () => {
    const dir = await makeDir();
    const path = join(dir, "settings.json");
    await writeFile(
      path,
      JSON.stringify({ version: 1, openai: { apiKey: "sk-migrate" }, sync: { bucket: "b" } }),
      "utf-8",
    );
    const loaded = await loadSettingsFromPath(path);
    expect(loaded.openai?.apiKey).toBe("");
    expect(loaded.sync?.bucket).toBe("b");
    expect(await getCredential("openai.apiKey")).toBe("sk-migrate");
    const raw = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    expect((raw.openai as Record<string, unknown> | undefined)?.apiKey).toBeUndefined();
  });

  it("routes api keys through setSettings into credential store", async () => {
    await makeDir();
    await setSettings({ openai: { apiKey: "sk-set" } });
    expect(await getCredential("openai.apiKey")).toBe("sk-set");
  });

  it("round-trips non-secret fields via explicit path helpers", async () => {
    const dir = await makeDir();
    const path = join(dir, "settings.json");
    const next = { ...DEFAULT_SETTINGS, weather: { defaultZip: "90210" } };
    await saveSettingsToPath(path, next);
    const loaded = await loadSettingsFromPath(path);
    expect(loaded.weather?.defaultZip).toBe("90210");
    const raw = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    expect(raw.openai).toBeUndefined();
  });
});
