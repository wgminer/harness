import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { createTempDir } from "./__tests__/tempDir";

let currentUserDataDir = "/tmp";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: {
    getPath: vi.fn(() => currentUserDataDir),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
    on: vi.fn(),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => false),
    encryptString: vi.fn((s: string) => Buffer.from(s, "utf-8")),
    decryptString: vi.fn((b: Buffer) => b.toString("utf-8")),
  },
}));

const remoteStore = {
  readManifest: vi.fn(async () => null as null | {
    version: number;
    revision: string;
    contentRevision?: string;
    updatedAt: number;
    bundleHash: string;
  }),
  readBundle: vi.fn(async () => Buffer.alloc(0)),
  writeBundleAndManifest: vi.fn(async () => undefined),
  testConnection: vi.fn(async () => ({ ok: true as const })),
};

vi.mock("./remoteBackupStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./remoteBackupStore")>();
  return {
    ...actual,
    RemoteBackupStore: class {
      readManifest = remoteStore.readManifest;
      readBundle = remoteStore.readBundle;
      writeBundleAndManifest = remoteStore.writeBundleAndManifest;
      testConnection = remoteStore.testConnection;
    },
  };
});

import { getSyncStatus, runSyncNow } from "./sync";
import { getSettings, setSettings } from "./settings";
import { setCredential } from "./credentials";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  remoteStore.readManifest.mockReset();
  remoteStore.readBundle.mockReset();
  remoteStore.writeBundleAndManifest.mockReset();
  remoteStore.testConnection.mockReset();
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeDir(prefix = "sync-test-"): Promise<string> {
  const temp = await createTempDir(prefix);
  cleanups.push(temp.cleanup);
  return temp.path;
}

async function makeDevice(seed: Record<string, string>): Promise<string> {
  const dir = await makeDir("sync-device-");
  const localData = join(dir, "local-data");
  await mkdir(join(localData, "app-state"), { recursive: true });
  await mkdir(join(localData, "settings"), { recursive: true });
  await mkdir(join(localData, "themes"), { recursive: true });
  await mkdir(join(localData, "sync"), { recursive: true });
  for (const [rel, contents] of Object.entries(seed)) {
    const abs = join(localData, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, contents, "utf-8");
  }
  return dir;
}

async function configureR2(): Promise<void> {
  await setSettings({
    sync: {
      accountId: "test-account",
      bucket: "test-bucket",
      prefix: "harness/",
      accessKeyId: "test-key-id",
    },
  });
  await setCredential("r2.secretAccessKey", "test-secret");
}

describe("R2 sync", () => {
  beforeEach(() => {
    currentUserDataDir = "/tmp";
  });

  it("reports a clear error when R2 is unset", async () => {
    currentUserDataDir = await makeDevice({});
    const result = await runSyncNow();
    expect(result.ok).toBe(false);
    expect(result.status.configured).toBe(false);
    expect(result.status.provider).toBe("s3Backup");
    expect(result.status.lastError).toMatch(/Configure R2/);
  });

  it("pushes a bundle + manifest when remote is empty", async () => {
    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"hello":"world"}',
      "settings/settings.json": '{"version":1}',
    });
    await configureR2();
    remoteStore.readManifest.mockResolvedValue(null);

    const result = await runSyncNow();
    expect(result.ok).toBe(true);
    expect(result.status.lastAction).toBe("push");
    expect(remoteStore.writeBundleAndManifest).toHaveBeenCalledTimes(1);
  });

  it("returns noop when local and remote revisions match", async () => {
    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"a":1}',
      "settings/settings.json": '{"version":1}',
    });
    await configureR2();
    // Match on-disk settings after credential migration strip (same as runSyncNow).
    await getSettings();

    const { computeRevision } = await import("./syncBundle");
    const localData = join(currentUserDataDir, "local-data");
    const revision = await computeRevision(localData);
    const contentRevision = await computeRevision(localData, (await import("./syncBundle")).USER_CONTENT_SYNC_SCOPES);

    await writeFile(
      join(localData, "sync", "state.json"),
      JSON.stringify({
        lastSyncedRevision: revision,
        lastSyncedContentRevision: contentRevision,
        remoteRevision: revision,
      }),
      "utf-8",
    );

    remoteStore.readManifest.mockResolvedValue({
      version: 1,
      revision,
      contentRevision,
      updatedAt: Date.now(),
      bundleHash: "abc",
    });

    const result = await runSyncNow();
    expect(result.ok).toBe(true);
    expect(result.status.lastAction).toBe("noop");
  });

  it("getSyncStatus reports configured when R2 credentials are complete", async () => {
    currentUserDataDir = await makeDevice({});
    await configureR2();
    const status = await getSyncStatus();
    expect(status.configured).toBe(true);
    expect(status.bucket).toBe("test-bucket");
    expect(status.provider).toBe("s3Backup");
  });
});
