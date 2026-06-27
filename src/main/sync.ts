/**
 * Cloudflare R2 remote backup sync.
 *
 * Artifacts in the bucket (under the configured prefix):
 *   - bundle.json.gz : gzipped JSON archive of the synced scopes
 *   - manifest.json  : { revision, updatedAt, version, bundleHash }
 *
 * Active polling on window focus and every ~30s while the app is foregrounded
 * pulls when the remote manifest changes.
 */

import { BrowserWindow, ipcMain } from "electron";
import { RIG_PAGE_TITLE } from "../shared/rigPage";
import { watch, existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { SyncConflictReview, SyncDecision, SyncResult, SyncStatus } from "../shared/sync";
import {
  buildDefaultMergeChoices,
  buildMergedFileMap,
  buildSyncConflictReview,
  decideSyncAction,
  formatSyncStatusLine,
  syncResultChangedLocalData,
} from "../shared/sync";
import { isHarnessE2E } from "./e2eStub";
import type { SyncFileChoice } from "../shared/syncMerge";
import { getR2SecretAccessKey } from "./credentials";
import { getLocalDataDir, getLocalDataSyncDir } from "./localDataPaths";
import {
  isR2ConfigComplete,
  RemoteBackupStore,
  type BackupManifest,
} from "./remoteBackupStore";
import { getSettings, setSettings } from "./settings";
import {
  applyMergedFiles,
  backupScopedFiles,
  buildBundle,
  computeContentRevisionFromBundle,
  computeLocalMaxMtime,
  computeRevision,
  DEFAULT_SYNC_SCOPES,
  extractBundle,
  hashBundleBytes,
  listScopedFiles,
  parseBundle,
  USER_CONTENT_SYNC_SCOPES,
} from "./syncBundle";
import { fileExists } from "./utils";

const STATE_FILE = "state.json";
const LOCAL_BACKUP_DIR = "backups";
export const BUNDLE_FILENAME = "bundle.json.gz";
export const MANIFEST_FILENAME = "manifest.json";
const MANIFEST_VERSION = 1;
const POLL_INTERVAL_MS = 30_000;

interface PersistedState {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastAction: SyncStatus["lastAction"];
  lastSyncedRevision: string | null;
  lastSyncedContentRevision: string | null;
  remoteRevision: string | null;
}

const DEFAULT_STATE: PersistedState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastAction: null,
  lastSyncedRevision: null,
  lastSyncedContentRevision: null,
  remoteRevision: null,
};

function getStatePath(): string {
  return join(getLocalDataSyncDir(), STATE_FILE);
}

function getLocalBackupsRoot(): string {
  return join(getLocalDataSyncDir(), LOCAL_BACKUP_DIR);
}

async function loadState(): Promise<PersistedState> {
  const path = getStatePath();
  if (!(await fileExists(path))) return { ...DEFAULT_STATE };
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as Partial<PersistedState>;
    return {
      lastAttemptAt: typeof raw.lastAttemptAt === "number" ? raw.lastAttemptAt : null,
      lastSuccessAt: typeof raw.lastSuccessAt === "number" ? raw.lastSuccessAt : null,
      lastError: typeof raw.lastError === "string" ? raw.lastError : null,
      lastAction:
        raw.lastAction === "push" ||
        raw.lastAction === "pull" ||
        raw.lastAction === "noop" ||
        raw.lastAction === "merge"
          ? raw.lastAction
          : null,
      lastSyncedRevision:
        typeof raw.lastSyncedRevision === "string" ? raw.lastSyncedRevision : null,
      lastSyncedContentRevision:
        typeof raw.lastSyncedContentRevision === "string"
          ? raw.lastSyncedContentRevision
          : null,
      remoteRevision: typeof raw.remoteRevision === "string" ? raw.remoteRevision : null,
    };
  } catch {
    return { ...DEFAULT_STATE, lastError: "Invalid sync state file" };
  }
}

async function saveState(state: PersistedState): Promise<void> {
  await writeFile(getStatePath(), JSON.stringify(state, null, 2), "utf-8");
}

async function buildRemoteStore(): Promise<RemoteBackupStore | null> {
  const settings = await getSettings();
  const secret = await getR2SecretAccessKey();
  if (!isR2ConfigComplete(settings.sync, Boolean(secret))) return null;
  return new RemoteBackupStore({
    accountId: settings.sync!.accountId,
    bucket: settings.sync!.bucket,
    prefix: settings.sync!.prefix,
    accessKeyId: settings.sync!.accessKeyId,
    secretAccessKey: secret!,
  });
}

async function getSyncConfigStatus(): Promise<{
  configured: boolean;
  accountId: string | null;
  bucket: string | null;
  prefix: string | null;
  configError: string | null;
}> {
  const settings = await getSettings();
  const secret = await getR2SecretAccessKey();
  const sync = settings.sync;
  const accountId = sync?.accountId?.trim() || null;
  const bucket = sync?.bucket?.trim() || null;
  const prefix = sync?.prefix?.trim() || null;
  const configured = isR2ConfigComplete(sync, Boolean(secret));
  let configError: string | null = null;
  if (accountId || bucket || sync?.accessKeyId?.trim()) {
    if (!configured) {
      configError = "Complete R2 account ID, bucket, access key ID, and secret access key.";
    }
  }
  return { configured, accountId, bucket, prefix, configError };
}

function buildStatus(state: PersistedState, config: Awaited<ReturnType<typeof getSyncConfigStatus>>): SyncStatus {
  return {
    provider: "s3Backup",
    configured: config.configured,
    accountId: config.accountId,
    bucket: config.bucket,
    prefix: config.prefix,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError ?? config.configError,
    lastAction: state.lastAction,
    lastSyncedRevision: state.lastSyncedRevision,
    remoteRevision: state.remoteRevision,
    statusLine: formatSyncStatusLine({
      configured: config.configured,
      isSyncing: false,
      lastSuccessAt: state.lastSuccessAt,
      lastAction: state.lastAction,
      lastError: state.lastError ?? config.configError,
    }),
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const state = await loadState();
  const config = await getSyncConfigStatus();
  return buildStatus(state, config);
}

async function readRemoteContentRevision(
  store: RemoteBackupStore,
  manifest: BackupManifest,
): Promise<string> {
  if (typeof manifest.contentRevision === "string") return manifest.contentRevision;
  const bytes = await store.readBundle();
  return computeContentRevisionFromBundle(parseBundle(bytes));
}

async function resolveSyncDecision(params: {
  localRevision: string;
  localContentRevision: string;
  remoteManifest: BackupManifest;
  remoteContentRevision: string;
  lastSyncedRevision: string | null;
  lastSyncedContentRevision: string | null;
  localMaxMtimeMs: number;
}): Promise<SyncDecision> {
  const {
    localRevision,
    localContentRevision,
    remoteManifest,
    remoteContentRevision,
    lastSyncedRevision,
    lastSyncedContentRevision,
    localMaxMtimeMs,
  } = params;

  if (localRevision === remoteManifest.revision) return "noop";

  const contentDecision = decideSyncAction({
    localRevision: localContentRevision,
    remoteRevision: remoteContentRevision,
    lastSyncedRevision: lastSyncedContentRevision ?? lastSyncedRevision,
    remoteUpdatedAt: remoteManifest.updatedAt,
    localMaxMtimeMs,
  });

  if (contentDecision !== "noop") return contentDecision;

  return decideSyncAction({
    localRevision,
    remoteRevision: remoteManifest.revision,
    lastSyncedRevision,
    remoteUpdatedAt: remoteManifest.updatedAt,
    localMaxMtimeMs: 0,
  });
}

async function loadLocalScopedFileMap(): Promise<Record<string, Buffer>> {
  const localDataDir = getLocalDataDir();
  const files = await listScopedFiles(localDataDir, DEFAULT_SYNC_SCOPES);
  const out: Record<string, Buffer> = {};
  for (const rel of files) {
    out[rel] = await readFile(join(localDataDir, rel));
  }
  return out;
}

async function loadRemoteScopedFileMap(
  store: RemoteBackupStore,
  manifest: BackupManifest,
): Promise<Record<string, Buffer>> {
  const bytes = await store.readBundle();
  const actualHash = hashBundleBytes(bytes);
  if (actualHash !== manifest.bundleHash) {
    throw new Error("Remote bundle hash does not match its manifest.");
  }
  const doc = parseBundle(bytes);
  const out: Record<string, Buffer> = {};
  for (const entry of doc.entries) {
    out[entry.path] = Buffer.from(entry.contents, "base64");
  }
  return out;
}

function mergeWarningFromReview(review: SyncConflictReview): string | undefined {
  const skipped = review.files.filter((file) => file.kind === "conflict" && !file.supportsMerge);
  if (skipped.length === 0) return undefined;
  const labels = skipped.map((file) => file.label).join(", ");
  return `Some files could not be merged (${labels}); this device's copies were kept.`;
}

async function mergeConflictResolution(
  store: RemoteBackupStore,
  remoteManifest: BackupManifest,
  choices: Record<string, SyncFileChoice>,
  now: number,
): Promise<void> {
  suppressSyncSchedule();
  const localFiles = await loadLocalScopedFileMap();
  const remoteFiles = await loadRemoteScopedFileMap(store, remoteManifest);
  const mergedFiles = buildMergedFileMap(localFiles, remoteFiles, choices);
  const localData = getLocalDataDir();
  const backupSnapshotDir = join(getLocalBackupsRoot(), String(now));
  await backupScopedFiles(localData, backupSnapshotDir, DEFAULT_SYNC_SCOPES);
  await applyMergedFiles(localData, mergedFiles, DEFAULT_SYNC_SCOPES);
}

async function autoMergeAndPush(
  store: RemoteBackupStore,
  remoteManifest: BackupManifest,
  now: number,
): Promise<{ mergeWarning?: string }> {
  const localFiles = await loadLocalScopedFileMap();
  const remoteFiles = await loadRemoteScopedFileMap(store, remoteManifest);
  const review = buildSyncConflictReview(localFiles, remoteFiles);
  const choices = buildDefaultMergeChoices(review);
  await mergeConflictResolution(store, remoteManifest, choices, now);
  const mergeWarning = mergeWarningFromReview(review);
  const localRevision = await computeRevision(getLocalDataDir(), DEFAULT_SYNC_SCOPES);
  await pushLocalToRemote(store, localRevision, now);
  return { mergeWarning };
}

async function pushLocalToRemote(
  store: RemoteBackupStore,
  localRevision: string,
  now: number,
): Promise<{ bundleHash: string }> {
  const { bytes, bundleHash } = await buildBundle(getLocalDataDir(), DEFAULT_SYNC_SCOPES);
  const contentRevision = await computeRevision(getLocalDataDir(), USER_CONTENT_SYNC_SCOPES);
  const manifest: BackupManifest = {
    version: MANIFEST_VERSION,
    revision: localRevision,
    contentRevision,
    updatedAt: now,
    bundleHash,
  };
  await store.writeBundleAndManifest({ bundleBytes: bytes, manifest });
  return { bundleHash };
}

async function pullRemoteIntoLocal(
  store: RemoteBackupStore,
  manifest: BackupManifest,
  now: number,
): Promise<{ filesWritten: number }> {
  suppressSyncSchedule();
  const bytes = await store.readBundle();
  const actualHash = hashBundleBytes(bytes);
  if (actualHash !== manifest.bundleHash) {
    throw new Error("Remote bundle hash does not match its manifest.");
  }
  const doc = parseBundle(bytes);
  const backupSnapshotDir = join(getLocalBackupsRoot(), String(now));
  const localData = getLocalDataDir();
  await backupScopedFiles(localData, backupSnapshotDir, DEFAULT_SYNC_SCOPES);
  return extractBundle(localData, doc, DEFAULT_SYNC_SCOPES);
}

let inFlight: Promise<SyncResult> | null = null;
let pollInFlight: Promise<void> | null = null;

const SYNC_DEBOUNCE_MS = 2500;
const SYNC_SUPPRESS_MS = 3000;

let syncScheduleTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let suppressScheduleUntil = 0;
let autoSyncWatcherStarted = false;
let lastObservedRemoteRevision: string | null = null;

function suppressSyncSchedule(ms = SYNC_SUPPRESS_MS): void {
  suppressScheduleUntil = Date.now() + ms;
}

function broadcastSyncChanged(): void {
  const wins = BrowserWindow.getAllWindows?.() ?? [];
  for (const win of wins) {
    if (!win.isDestroyed()) {
      win.webContents.send("sync:changed");
    }
  }
}

function runScheduledSync(): void {
  void runSyncNow();
}

export function scheduleSyncAfterLocalChange(): void {
  if (isHarnessE2E()) return;
  if (Date.now() < suppressScheduleUntil) return;
  if (syncScheduleTimer) clearTimeout(syncScheduleTimer);
  syncScheduleTimer = setTimeout(() => {
    syncScheduleTimer = null;
    runScheduledSync();
  }, SYNC_DEBOUNCE_MS);
}

function startAutoSyncWatcher(): void {
  if (autoSyncWatcherStarted || isHarnessE2E()) return;
  autoSyncWatcherStarted = true;

  const localDataDir = getLocalDataDir();
  const watchedDirs = [
    join(localDataDir, "app-state"),
    join(localDataDir, "themes"),
    join(localDataDir, "settings"),
  ];

  for (const dir of watchedDirs) {
    if (!existsSync(dir)) continue;
    watch(dir, { recursive: true }, () => scheduleSyncAfterLocalChange());
  }
}

function startActivePolling(): void {
  if (isHarnessE2E() || pollTimer) return;

  const pollOnce = () => {
    if (pollInFlight) return;
    pollInFlight = pollRemoteManifest()
      .catch(() => undefined)
      .finally(() => {
        pollInFlight = null;
      });
  };

  pollOnce();

  for (const win of BrowserWindow.getAllWindows()) {
    win.on("focus", pollOnce);
  }

  pollTimer = setInterval(() => {
    const wins = BrowserWindow.getAllWindows();
    const anyFocused = wins.some((w) => !w.isDestroyed() && w.isFocused());
    if (anyFocused) pollOnce();
  }, POLL_INTERVAL_MS);
}

async function pollRemoteManifest(): Promise<void> {
  const store = await buildRemoteStore();
  if (!store) return;

  const manifest = await store.readManifest();
  const remoteRevision = manifest?.revision ?? null;
  const state = await loadState();

  if (remoteRevision && remoteRevision !== lastObservedRemoteRevision) {
    const prev = lastObservedRemoteRevision;
    lastObservedRemoteRevision = remoteRevision;
    if (prev !== null && remoteRevision !== state.lastSyncedRevision) {
      await saveState({ ...state, remoteRevision, lastError: null });
      broadcastSyncChanged();
      await runSyncNow();
      return;
    }
  }

  if (remoteRevision !== state.remoteRevision) {
    await saveState({ ...state, remoteRevision });
    broadcastSyncChanged();
  }
}

function runExclusive(task: () => Promise<SyncResult>): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = task().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function runSyncNow(): Promise<SyncResult> {
  return runExclusive(async () => {
    const result = await runSyncNowInner();
    if (syncResultChangedLocalData(result)) {
      broadcastSyncChanged();
    }
    if (result.status.remoteRevision) {
      lastObservedRemoteRevision = result.status.remoteRevision;
    }
    return result;
  });
}

async function runSyncNowInner(): Promise<SyncResult> {
  const now = Date.now();
  const config = await getSyncConfigStatus();
  const state = await loadState();
  const next: PersistedState = { ...state, lastAttemptAt: now, lastError: null };

  if (!config.configured) {
    next.lastError = config.configError ?? `Configure R2 sync in ${RIG_PAGE_TITLE}.`;
    await saveState(next);
    return {
      ok: false,
      status: buildStatus(next, config),
    };
  }

  const store = await buildRemoteStore();
  if (!store) {
    next.lastError = "R2 credentials are incomplete.";
    await saveState(next);
    return { ok: false, status: buildStatus(next, config) };
  }

  try {
    const remoteManifest = await store.readManifest();
    const localRevision = await computeRevision(getLocalDataDir(), DEFAULT_SYNC_SCOPES);
    const localContentRevision = await computeRevision(
      getLocalDataDir(),
      USER_CONTENT_SYNC_SCOPES,
    );

    if (!remoteManifest) {
      await pushLocalToRemote(store, localRevision, now);
      next.lastSuccessAt = now;
      next.lastAction = "push";
      next.lastSyncedRevision = localRevision;
      next.lastSyncedContentRevision = localContentRevision;
      next.remoteRevision = localRevision;
      await saveState(next);
      return { ok: true, status: buildStatus(next, config) };
    }

    next.remoteRevision = remoteManifest.revision;

    const localMaxMtimeMs = await computeLocalMaxMtime(
      getLocalDataDir(),
      USER_CONTENT_SYNC_SCOPES,
    );
    const remoteContentRevision = await readRemoteContentRevision(store, remoteManifest);
    const decision = await resolveSyncDecision({
      localRevision,
      localContentRevision,
      remoteManifest,
      remoteContentRevision,
      lastSyncedRevision: state.lastSyncedRevision,
      lastSyncedContentRevision: state.lastSyncedContentRevision,
      localMaxMtimeMs,
    });

    if (decision === "conflict" || decision === "merge") {
      const { mergeWarning } = await autoMergeAndPush(store, remoteManifest, now);
      const mergedRevision = await computeRevision(getLocalDataDir(), DEFAULT_SYNC_SCOPES);
      const mergedContentRevision = await computeRevision(
        getLocalDataDir(),
        USER_CONTENT_SYNC_SCOPES,
      );
      next.lastSuccessAt = now;
      next.lastAction = "merge";
      next.lastSyncedRevision = mergedRevision;
      next.lastSyncedContentRevision = mergedContentRevision;
      next.remoteRevision = mergedRevision;
      next.lastError = null;
      await saveState(next);
      return {
        ok: true,
        status: buildStatus(next, config),
        mergeWarning,
      };
    }

    return finishSyncAction({
      decision,
      store,
      config,
      remoteManifest,
      localRevision,
      localContentRevision,
      remoteContentRevision,
      now,
      state: next,
    });
  } catch (err) {
    next.lastError = err instanceof Error ? err.message : String(err);
    await saveState(next);
    return { ok: false, status: buildStatus(next, config) };
  }
}

async function finishSyncAction(params: {
  decision: "push" | "pull" | "noop";
  store: RemoteBackupStore;
  config: Awaited<ReturnType<typeof getSyncConfigStatus>>;
  remoteManifest: BackupManifest;
  localRevision: string;
  localContentRevision: string;
  remoteContentRevision: string;
  now: number;
  state: PersistedState;
}): Promise<SyncResult> {
  const {
    decision,
    store,
    config,
    remoteManifest,
    localRevision,
    localContentRevision,
    remoteContentRevision,
    now,
  } = params;
  const next = params.state;

  if (decision === "noop") {
    next.lastSuccessAt = now;
    next.lastAction = "noop";
    next.lastSyncedRevision = localRevision;
    next.lastSyncedContentRevision = localContentRevision;
    next.remoteRevision = remoteManifest.revision;
    next.lastError = null;
    await saveState(next);
    return { ok: true, status: buildStatus(next, config) };
  }

  if (decision === "pull") {
    await pullRemoteIntoLocal(store, remoteManifest, now);
    next.lastSuccessAt = now;
    next.lastAction = "pull";
    next.lastSyncedRevision = remoteManifest.revision;
    next.lastSyncedContentRevision = remoteContentRevision;
    next.remoteRevision = remoteManifest.revision;
    next.lastError = null;
    await saveState(next);
    return { ok: true, status: buildStatus(next, config) };
  }

  await pushLocalToRemote(store, localRevision, now);
  next.lastSuccessAt = now;
  next.lastAction = "push";
  next.lastSyncedRevision = localRevision;
  next.lastSyncedContentRevision = localContentRevision;
  next.remoteRevision = localRevision;
  next.lastError = null;
  await saveState(next);
  return { ok: true, status: buildStatus(next, config) };
}

async function testR2Connection(): Promise<{ ok: boolean; error?: string }> {
  const store = await buildRemoteStore();
  if (!store) {
    return { ok: false, error: "R2 settings or secret access key is incomplete." };
  }
  const result = await store.testConnection();
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

async function setR2SecretAccessKey(secret: string): Promise<void> {
  const { setCredential } = await import("./credentials");
  await setCredential("r2.secretAccessKey", secret);
}

export function registerSyncHandlers(): void {
  startAutoSyncWatcher();
  startActivePolling();
  ipcMain.handle("sync:getStatus", () => getSyncStatus());
  ipcMain.handle("sync:runNow", () => runSyncNow());
  ipcMain.handle("sync:testConnection", () => testR2Connection());
  ipcMain.handle("sync:setR2SecretAccessKey", (_e, secret: string) => setR2SecretAccessKey(secret));
  ipcMain.handle("sync:setR2Config", async (_e, partial: { accountId?: string; bucket?: string; prefix?: string; accessKeyId?: string }) => {
    const current = await getSettings();
    await setSettings({
      sync: {
        accountId: partial.accountId ?? current.sync?.accountId ?? "",
        bucket: partial.bucket ?? current.sync?.bucket ?? "",
        prefix: partial.prefix ?? current.sync?.prefix ?? "harness/",
        accessKeyId: partial.accessKeyId ?? current.sync?.accessKeyId ?? "",
      },
    });
    return getSyncStatus();
  });
}

export { getLocalBackupsRoot };
