import { describe, expect, it } from "vitest";
import { decideSyncAction } from "./sync";

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
