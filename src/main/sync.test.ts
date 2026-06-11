import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync } from "fs";
import { mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { createTempDir } from "./__tests__/tempDir";

let currentUserDataDir = "/tmp";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: {
    getPath: vi.fn(() => currentUserDataDir),
  },
  BrowserWindow: { getAllWindows: vi.fn() },
  dialog: { showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
  shell: { openPath: vi.fn(async () => "") },
}));

import { BUNDLE_FILENAME, MANIFEST_FILENAME, getSyncStatus, runSyncNow } from "./sync";
import { setSettings } from "./settings";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
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

/**
 * Set up a fake "device" — a unique userData dir with seeded local-data.
 * Each test usually creates two devices and a third "backup" folder that
 * stands in for the cloud-synced directory shared between them.
 */
async function makeDevice(seed: Record<string, string>): Promise<string> {
  const dir = await makeDir("sync-device-");
  const localData = join(dir, "local-data");
  await mkdir(join(localData, "app-state"), { recursive: true });
  await mkdir(join(localData, "settings"), { recursive: true });
  await mkdir(join(localData, "themes"), { recursive: true });
  for (const [rel, contents] of Object.entries(seed)) {
    const abs = join(localData, rel);
    await mkdir(join(abs, ".."), { recursive: true });
    await writeFile(abs, contents, "utf-8");
  }
  return dir;
}

async function setBackupFolderInSettings(folder: string): Promise<void> {
  await setSettings({ backup: { folderPath: folder } });
}

describe("folder-backup sync", () => {
  beforeEach(() => {
    currentUserDataDir = "/tmp";
  });

  it("reports a clear error when the backup folder is unset", async () => {
    currentUserDataDir = await makeDevice({});
    const result = await runSyncNow();
    expect(result.ok).toBe(false);
    expect(result.status.configured).toBe(false);
    expect(result.status.lastError).toMatch(/Pick a backup folder/);
    expect(result.status.provider).toBe("folderBackup");
  });

  it("pushes a bundle + manifest into an empty backup folder", async () => {
    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"hello":"world"}',
      "settings/settings.json": '{"version":1}',
    });
    const backup = await makeDir("sync-backup-");
    await setBackupFolderInSettings(backup);

    const result = await runSyncNow();
    expect(result.ok).toBe(true);
    expect(result.status.lastAction).toBe("push");
    expect(result.status.lastSyncedRevision).toBeTruthy();

    expect(existsSync(join(backup, BUNDLE_FILENAME))).toBe(true);
    expect(existsSync(join(backup, MANIFEST_FILENAME))).toBe(true);

    const manifest = JSON.parse(await readFile(join(backup, MANIFEST_FILENAME), "utf-8"));
    expect(manifest.revision).toBe(result.status.lastSyncedRevision);
    expect(typeof manifest.bundleHash).toBe("string");
  });

  it("a second device pulls the backup, restoring the synced files locally", async () => {
    const backup = await makeDir("sync-backup-");

    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"from":"A"}',
      "settings/settings.json": '{"version":1,"openai":{"apiKey":"k1"}}',
      "themes/active.json": '{"accent":"#fff"}',
    });
    await setBackupFolderInSettings(backup);
    const pushResult = await runSyncNow();
    expect(pushResult.status.lastAction).toBe("push");

    currentUserDataDir = await makeDevice({});
    await setBackupFolderInSettings(backup);
    const pullResult = await runSyncNow();
    expect(pullResult.ok).toBe(true);
    expect(pullResult.status.lastAction).toBe("pull");

    const restored = await readFile(
      join(currentUserDataDir, "local-data", "app-state", "conversations.json"),
      "utf-8",
    );
    expect(restored).toBe('{"from":"A"}');
    const themeRestored = await readFile(
      join(currentUserDataDir, "local-data", "themes", "active.json"),
      "utf-8",
    );
    expect(themeRestored).toBe('{"accent":"#fff"}');
  });

  it("auto-merges when a device has local edits and the backup also changed", async () => {
    const backup = await makeDir("sync-backup-");

    const deviceA = await makeDevice({
      "app-state/conversations.json": '{"from":"shared"}',
    });
    currentUserDataDir = deviceA;
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    const deviceB = await makeDevice({});
    currentUserDataDir = deviceB;
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    await writeFile(
      join(deviceB, "local-data", "app-state", "conversations.json"),
      '{"from":"B-local"}',
      "utf-8",
    );

    await writeFile(
      join(deviceA, "local-data", "app-state", "conversations.json"),
      '{"from":"A"}',
      "utf-8",
    );
    currentUserDataDir = deviceA;
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    currentUserDataDir = deviceB;
    await setBackupFolderInSettings(backup);
    const result = await runSyncNow();
    expect(result.ok).toBe(true);
    expect(result.status.lastAction).toBe("merge");
  });

  it("auto-merge combines both sides and pushes", async () => {
    const backup = await makeDir("sync-backup-");

    const deviceA = await makeDevice({
      "app-state/conversations.json": '{"shared":{"title":"Shared","createdAt":1}}',
    });
    currentUserDataDir = deviceA;
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    const deviceB = await makeDevice({});
    currentUserDataDir = deviceB;
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    await writeFile(
      join(deviceB, "local-data", "app-state", "conversations.json"),
      '{"local-only":{"title":"B only","createdAt":2}}',
      "utf-8",
    );

    await writeFile(
      join(deviceA, "local-data", "app-state", "conversations.json"),
      '{"shared":{"title":"Shared","createdAt":1},"remote-only":{"title":"A only","createdAt":3}}',
      "utf-8",
    );
    currentUserDataDir = deviceA;
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    currentUserDataDir = deviceB;
    await setBackupFolderInSettings(backup);
    const mergeResult = await runSyncNow();
    expect(mergeResult.ok).toBe(true);
    expect(mergeResult.status.lastAction).toBe("merge");

    const merged = JSON.parse(
      await readFile(join(deviceB, "local-data", "app-state", "conversations.json"), "utf-8"),
    );
    expect(merged).toMatchObject({
      shared: { title: "Shared", createdAt: 1 },
      "local-only": { title: "B only", createdAt: 2 },
      "remote-only": { title: "A only", createdAt: 3 },
    });
  });

  it("backs up local data into local-data/sync/backups/<ts>/ before extracting", async () => {
    const backup = await makeDir("sync-backup-");

    const deviceA = await makeDevice({
      "app-state/conversations.json": '{"from":"A-v1"}',
    });
    currentUserDataDir = deviceA;
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    const deviceB = await makeDevice({});
    currentUserDataDir = deviceB;
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    await writeFile(
      join(deviceA, "local-data", "app-state", "conversations.json"),
      '{"from":"A-v2"}',
      "utf-8",
    );
    currentUserDataDir = deviceA;
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    currentUserDataDir = deviceB;
    await setBackupFolderInSettings(backup);
    const pullResult = await runSyncNow();
    expect(pullResult.ok).toBe(true);
    expect(pullResult.status.lastAction).toBe("pull");

    const backupsDir = join(deviceB, "local-data", "sync", "backups");
    const snapshots = (await readdir(backupsDir)).sort();
    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    const savedConv = await readFile(
      join(backupsDir, snapshots[snapshots.length - 1], "app-state", "conversations.json"),
      "utf-8",
    );
    expect(savedConv).toBe('{"from":"A-v1"}');
  });

  it("returns a no-op when local and backup revisions match", async () => {
    const backup = await makeDir("sync-backup-");
    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"a":1}',
    });
    await setBackupFolderInSettings(backup);

    await runSyncNow();
    const second = await runSyncNow();
    expect(second.ok).toBe(true);
    expect(second.status.lastAction).toBe("noop");
  });

  it("reports a still-downloading error when the bundle file is zero-byte", async () => {
    const backup = await makeDir("sync-backup-");
    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"a":1}',
    });
    await setBackupFolderInSettings(backup);
    // Drop a zero-byte placeholder bundle into the backup folder.
    await writeFile(join(backup, BUNDLE_FILENAME), Buffer.alloc(0));

    const result = await runSyncNow();
    expect(result.ok).toBe(false);
    expect(result.status.lastError).toMatch(/still downloading/);
  });

  it("reports a still-downloading error when an .icloud sibling placeholder is present", async () => {
    const backup = await makeDir("sync-backup-");
    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"a":1}',
    });
    await setBackupFolderInSettings(backup);
    await writeFile(join(backup, `.${BUNDLE_FILENAME}.icloud`), "placeholder");

    const result = await runSyncNow();
    expect(result.ok).toBe(false);
    expect(result.status.lastError).toMatch(/still downloading/);
  });

  it("does not push over an existing bundle when manifest.json is still missing", async () => {
    const backup = await makeDir("sync-backup-");

    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"from":"remote"}',
    });
    await setBackupFolderInSettings(backup);
    await runSyncNow();

    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"from":"local"}',
    });
    await setBackupFolderInSettings(backup);
    await rm(join(backup, MANIFEST_FILENAME));

    const result = await runSyncNow();
    expect(result.ok).toBe(false);
    expect(result.status.lastError).toMatch(/manifest is still downloading/);

    const remoteConv = await readFile(
      join(backup, BUNDLE_FILENAME),
    );
    expect(remoteConv.length).toBeGreaterThan(0);
    const parsed = JSON.parse(
      (await import("zlib")).gunzipSync(remoteConv).toString("utf-8"),
    );
    const convEntry = parsed.entries.find(
      (e: { path: string }) => e.path === "app-state/conversations.json",
    );
    expect(Buffer.from(convEntry.contents, "base64").toString("utf-8")).toBe('{"from":"remote"}');
  });

  it("getSyncStatus reports backupReadiness when manifest is missing but bundle exists", async () => {
    const backup = await makeDir("sync-backup-");
    currentUserDataDir = await makeDevice({
      "app-state/conversations.json": '{"a":1}',
    });
    await setBackupFolderInSettings(backup);
    await runSyncNow();
    await rm(join(backup, MANIFEST_FILENAME));

    const status = await getSyncStatus();
    expect(status.configured).toBe(true);
    expect(status.backupReadiness).toMatch(/manifest is still downloading/);
  });

  it("getSyncStatus reports configured=true and the resolved folder path", async () => {
    const backup = await makeDir("sync-backup-");
    currentUserDataDir = await makeDevice({});
    await setBackupFolderInSettings(backup);

    const status = await getSyncStatus();
    expect(status.configured).toBe(true);
    expect(status.backupFolderPath).toBe(backup);
    expect(status.folderError).toBeNull();
  });

  it("getSyncStatus reports a folder error when the path no longer exists", async () => {
    currentUserDataDir = await makeDevice({});
    await setBackupFolderInSettings("/non/existent/path-xyz-12345");

    const status = await getSyncStatus();
    expect(status.configured).toBe(false);
    expect(status.folderError).toMatch(/not found/);
  });
});
