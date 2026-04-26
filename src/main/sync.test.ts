import { afterEach, describe, expect, it, vi } from "vitest";
import { access } from "fs/promises";
import { constants } from "fs";
import { join } from "path";
import { createTempDir } from "./__tests__/tempDir";

let currentUserDataDir = "/tmp";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: {
    getPath: vi.fn(() => currentUserDataDir),
  },
}));

import { getSyncStatus, runSyncNow } from "./sync";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_API_KEY;
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(): Promise<string> {
  const temp = await createTempDir("sync-test-");
  cleanups.push(temp.cleanup);
  return temp.path;
}

describe("firebase sync scaffold", () => {
  it("reports unconfigured status and returns a useful error", async () => {
    const dir = await makeDir();
    currentUserDataDir = dir;
    const result = await runSyncNow();
    expect(result.ok).toBe(false);
    expect(result.status.configured).toBe(false);
    expect(result.status.lastError).toContain("Firebase is not configured");
  });

  it("writes a manifest when firebase env is configured", async () => {
    const dir = await makeDir();
    currentUserDataDir = dir;
    process.env.FIREBASE_PROJECT_ID = "proj_1";
    process.env.FIREBASE_API_KEY = "key_1";

    const result = await runSyncNow();
    expect(result.ok).toBe(true);

    const syncDir = join(dir, "local-data", "sync");
    await access(join(syncDir, "manifest.json"), constants.F_OK);
    const status = await getSyncStatus();
    expect(status.lastSuccessAt).not.toBeNull();
    expect(status.lastUploadedRevision).toBeTruthy();
  });
});
