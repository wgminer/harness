import { describe, expect, it } from "vitest";
import {
  decideSyncAction,
  sidebarSyncStatusTooltip,
  syncInlineStatusLine,
  syncNowButtonTooltip,
} from "./sync";

describe("decideSyncAction", () => {
  const local = "local-rev";
  const remote = "remote-rev";
  const synced = "common-rev";

  it("pushes when the backup folder is empty", () => {
    expect(
      decideSyncAction({
        localRevision: local,
        remoteRevision: null,
        lastSyncedRevision: null,
        remoteUpdatedAt: null,
        localMaxMtimeMs: 0,
      }),
    ).toBe("push");
  });

  it("no-ops when revisions match", () => {
    expect(
      decideSyncAction({
        localRevision: local,
        remoteRevision: local,
        lastSyncedRevision: synced,
        remoteUpdatedAt: 100,
        localMaxMtimeMs: 50,
      }),
    ).toBe("noop");
  });

  it("pulls when only the backup changed since last sync", () => {
    expect(
      decideSyncAction({
        localRevision: synced,
        remoteRevision: remote,
        lastSyncedRevision: synced,
        remoteUpdatedAt: 200,
        localMaxMtimeMs: 50,
      }),
    ).toBe("pull");
  });

  it("pushes when only local changed since last sync", () => {
    expect(
      decideSyncAction({
        localRevision: local,
        remoteRevision: synced,
        lastSyncedRevision: synced,
        remoteUpdatedAt: 200,
        localMaxMtimeMs: 250,
      }),
    ).toBe("push");
  });

  it("conflicts when both sides diverged from the last sync", () => {
    expect(
      decideSyncAction({
        localRevision: local,
        remoteRevision: remote,
        lastSyncedRevision: synced,
        remoteUpdatedAt: 200,
        localMaxMtimeMs: 250,
      }),
    ).toBe("conflict");
  });

  it("pulls on first sync when local files are older than the backup write", () => {
    expect(
      decideSyncAction({
        localRevision: local,
        remoteRevision: remote,
        lastSyncedRevision: null,
        remoteUpdatedAt: 200,
        localMaxMtimeMs: 100,
      }),
    ).toBe("pull");
  });

  it("conflicts on first sync when local files were edited after the backup write", () => {
    expect(
      decideSyncAction({
        localRevision: local,
        remoteRevision: remote,
        lastSyncedRevision: null,
        remoteUpdatedAt: 200,
        localMaxMtimeMs: 300,
      }),
    ).toBe("conflict");
  });
});

describe("syncNowButtonTooltip", () => {
  it("explains when backup is not configured", () => {
    expect(syncNowButtonTooltip({ busy: false, configured: false })).toBe(
      "Set up backup in System → Data",
    );
  });

  it("shows syncing state", () => {
    expect(syncNowButtonTooltip({ busy: true, configured: true })).toBe("Syncing…");
  });

  it("shows default label when ready", () => {
    expect(syncNowButtonTooltip({ busy: false, configured: true })).toBe("Sync now");
  });
});

describe("syncInlineStatusLine", () => {
  it("formats a compact synced hint", () => {
    const now = Date.now();
    expect(syncInlineStatusLine({ lastSuccessAt: now - 4_000 })).toBe("Synced 4s ago");
  });

  it("returns null when never synced", () => {
    expect(syncInlineStatusLine({ lastSuccessAt: null })).toBeNull();
  });
});

describe("sidebarSyncStatusTooltip", () => {
  it("points to Data setup when unconfigured", () => {
    expect(
      sidebarSyncStatusTooltip({
        busy: false,
        configured: false,
        lastError: null,
        lastSuccessAt: null,
      }),
    ).toBe("Set up sync in System → Data");
  });

  it("prefers last-synced when healthy", () => {
    const now = Date.now();
    expect(
      sidebarSyncStatusTooltip({
        busy: false,
        configured: true,
        lastError: null,
        lastSuccessAt: now - 120_000,
      }),
    ).toBe("Synced 2m ago");
  });

  it("surfaces the last error", () => {
    expect(
      sidebarSyncStatusTooltip({
        busy: false,
        configured: true,
        lastError: "R2 unavailable",
        lastSuccessAt: null,
      }),
    ).toBe("R2 unavailable");
  });
});
