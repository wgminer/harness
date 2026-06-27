import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "./__tests__/tempDir";

let userDataDir = "/tmp/harness-credentials-test";

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

import {
  getCredential,
  getCredentialStatus,
  migrateSecretsFromSettingsRaw,
  setCredential,
} from "./credentials";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

beforeEach(async () => {
  const temp = await createTempDir("credentials-test-");
  userDataDir = temp.path;
  cleanups.push(temp.cleanup);
});

describe("credentials store", () => {
  it("stores and retrieves secrets", async () => {
    await setCredential("openai.apiKey", "sk-test");
    expect(await getCredential("openai.apiKey")).toBe("sk-test");
    const status = await getCredentialStatus();
    expect(status.hasOpenAIApiKey).toBe(true);
    expect(status.hasTavilyApiKey).toBe(false);
  });

  it("clears a secret when set to empty", async () => {
    await setCredential("search.tavilyApiKey", "tvly-test");
    await setCredential("search.tavilyApiKey", "");
    expect(await getCredential("search.tavilyApiKey")).toBeNull();
  });

  it("returns secrets for the settings form", async () => {
    await setCredential("openai.apiKey", "sk-test");
    await setCredential("search.tavilyApiKey", "tvly-test");
    await setCredential("r2.secretAccessKey", "r2-secret");
    const { getSecretsForSettings } = await import("./credentials");
    await expect(getSecretsForSettings()).resolves.toEqual({
      openaiApiKey: "sk-test",
      tavilyApiKey: "tvly-test",
      r2SecretAccessKey: "r2-secret",
    });
  });

  it("migrates secrets out of settings.json raw and persists cleared file content", async () => {
    const raw = {
      version: 1,
      openai: { apiKey: "sk-migrate" },
      search: { tavilyApiKey: "tvly-migrate" },
    };
    const changed = await migrateSecretsFromSettingsRaw(raw);
    expect(changed).toBe(true);
    expect(raw.openai).toEqual({});
    expect(raw.search).toEqual({});
    expect(await getCredential("openai.apiKey")).toBe("sk-migrate");
    expect(await getCredential("search.tavilyApiKey")).toBe("tvly-migrate");

    await writeFile(join(userDataDir, "settings-backup.json"), JSON.stringify(raw), "utf-8");
    const persisted = JSON.parse(await readFile(join(userDataDir, "settings-backup.json"), "utf-8"));
    expect(persisted.openai?.apiKey).toBeUndefined();
  });
});
