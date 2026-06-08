/**
 * Folder-based backup sync (provider-agnostic).
 *
 * The user picks any folder on disk as the "backup folder". A cloud-sync
 * client (iCloud Drive, Dropbox, Google Drive, OneDrive, Syncthing, a
 * network share, an external drive…) is what actually moves bytes between
 * devices — Harness only ever reads and writes local files at that path.
 *
 * Two artifacts live in the backup folder:
 *   - bundle.json.gz : gzipped JSON archive of the synced scopes
 *   - manifest.json  : { revision, updatedAt, version, bundleHash }
 *
 * Sync now compares revisions against the last synced revision: pull when
 * only the backup changed, push when only local changed, and auto-merge when
 * both diverged.
 */

import { BrowserWindow, dialog, ipcMain, shell } from "electron";
import { RIG_PAGE_TITLE } from "../shared/rigPage";
import { existsSync } from "fs";
import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { join } from "path";
import type { SyncConflictReview, SyncFolderSuggestion, SyncResult, SyncStatus } from "../shared/sync";
import {
  buildDefaultMergeChoices,
  buildMergedFileMap,
  buildSyncConflictReview,
  decideSyncAction,
} from "../shared/sync";
import type { SyncFileChoice } from "../shared/syncMerge";
import { getLocalDataDir, getLocalDataSyncDir } from "./localDataPaths";
import { getSettings, setSettings } from "./settings";
import {
  atomicWriteFile,
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
  placeholderSiblingFor,
  USER_CONTENT_SYNC_SCOPES,
} from "./syncBundle";
import { listFolderSuggestions } from "./syncSuggestions";
import { fileExists } from "./utils";

const STATE_FILE = "state.json";
const LOCAL_BACKUP_DIR = "backups";
export const BUNDLE_FILENAME = "bundle.json.gz";
export const MANIFEST_FILENAME = "manifest.json";
const MANIFEST_VERSION = 1;

interface PersistedState {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastAction: SyncStatus["lastAction"];
  lastSyncedRevision: string | null;
  lastSyncedContentRevision: string | null;
}

interface BackupManifest {
  version: number;
  revision: string;
  contentRevision?: string;
  updatedAt: number;
  bundleHash: string;
}

const DEFAULT_STATE: PersistedState = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastAction: null,
  lastSyncedRevision: null,
  lastSyncedContentRevision: null,
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
    };
  } catch {
    return { ...DEFAULT_STATE, lastError: "Invalid sync state file" };
  }
}

async function saveState(state: PersistedState): Promise<void> {
  await writeFile(getStatePath(), JSON.stringify(state, null, 2), "utf-8");
}

async function getBackupFolderPath(): Promise<string | null> {
  const settings = await getSettings();
  const path = settings.backup?.folderPath?.trim();
  return path && path.length > 0 ? path : null;
}

async function checkFolderAccessible(folder: string | null): Promise<{
  configured: boolean;
  error: string | null;
}> {
  if (!folder) return { configured: false, error: null };
  if (!existsSync(folder)) {
    return { configured: false, error: `Backup folder not found: ${folder}` };
  }
  try {
    const s = await stat(folder);
    if (!s.isDirectory()) {
      return { configured: false, error: `Backup path is not a folder: ${folder}` };
    }
  } catch (err) {
    return {
      configured: false,
      error: `Cannot access backup folder: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return { configured: true, error: null };
}

async function listConflictCopies(folder: string | null): Promise<string[]> {
  if (!folder || !existsSync(folder)) return [];
  try {
    const entries = await readdir(folder);
    return entries.filter(
      (name) =>
        name !== BUNDLE_FILENAME &&
        name !== MANIFEST_FILENAME &&
        (name.toLowerCase().includes("conflicted copy") ||
          name.toLowerCase().includes("conflict") ||
          name.includes("(") ||
          name.startsWith("manifest") ||
          name.startsWith("bundle.json")) &&
        // Don't flag the canonical names (already filtered) or our own tmp files.
        !name.endsWith(".tmp"),
    );
  } catch {
    return [];
  }
}

function buildStatus(
  state: PersistedState,
  folderPath: string | null,
  folderCheck: { configured: boolean; error: string | null },
  conflictCopies: string[],
): SyncStatus {
  return {
    provider: "folderBackup",
    configured: folderCheck.configured,
    backupFolderPath: folderPath,
    folderError: folderCheck.error,
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    lastAction: state.lastAction,
    lastSyncedRevision: state.lastSyncedRevision,
    conflictCopies,
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const state = await loadState();
  const folderPath = await getBackupFolderPath();
  const folderCheck = await checkFolderAccessible(folderPath);
  const conflictCopies = folderCheck.configured
    ? await listConflictCopies(folderPath)
    : [];
  return buildStatus(state, folderPath, folderCheck, conflictCopies);
}

async function readManifestFromBackup(folder: string): Promise<BackupManifest | null> {
  const path = join(folder, MANIFEST_FILENAME);
  if (!(await fileExists(path))) return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as Partial<BackupManifest>;
    if (
      typeof raw.revision === "string" &&
      typeof raw.updatedAt === "number" &&
      typeof raw.bundleHash === "string" &&
      typeof raw.version === "number"
    ) {
      return {
        version: raw.version,
        revision: raw.revision,
        updatedAt: raw.updatedAt,
        bundleHash: raw.bundleHash,
      };
    }
  } catch {
    // Fall through to null below.
  }
  return null;
}

async function bundlePlaceholderError(folder: string): Promise<string | null> {
  const bundlePath = join(folder, BUNDLE_FILENAME);
  const placeholderPath = join(folder, placeholderSiblingFor(BUNDLE_FILENAME));
  if (existsSync(placeholderPath)) {
    return "Backup is still downloading from your sync provider — try again shortly.";
  }
  if (existsSync(bundlePath)) {
    try {
      const s = await stat(bundlePath);
      if (s.size === 0) {
        return "Backup is still downloading from your sync provider — try again shortly.";
      }
    } catch (err) {
      return `Could not read backup bundle: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return null;
}

async function readRemoteContentRevision(
  folder: string,
  manifest: BackupManifest,
): Promise<string> {
  if (typeof manifest.contentRevision === "string") return manifest.contentRevision;
  const bytes = await readFile(join(folder, BUNDLE_FILENAME));
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
}): Promise<"push" | "pull" | "noop" | "conflict"> {
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
  folder: string,
  manifest: BackupManifest,
): Promise<Record<string, Buffer>> {
  const bundlePath = join(folder, BUNDLE_FILENAME);
  const bytes = await readFile(bundlePath);
  const actualHash = hashBundleBytes(bytes);
  if (actualHash !== manifest.bundleHash) {
    throw new Error(
      "Backup bundle hash does not match its manifest — the bundle may still be syncing. Try again shortly.",
    );
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
  folderPath: string,
  remoteManifest: BackupManifest,
  choices: Record<string, SyncFileChoice>,
  now: number,
): Promise<void> {
  const localFiles = await loadLocalScopedFileMap();
  const remoteFiles = await loadRemoteScopedFileMap(folderPath, remoteManifest);
  const mergedFiles = buildMergedFileMap(localFiles, remoteFiles, choices);
  const localData = getLocalDataDir();
  const backupSnapshotDir = join(getLocalBackupsRoot(), String(now));
  await backupScopedFiles(localData, backupSnapshotDir, DEFAULT_SYNC_SCOPES);
  await applyMergedFiles(localData, mergedFiles, DEFAULT_SYNC_SCOPES);
}

async function autoMergeAndPush(
  folderPath: string,
  remoteManifest: BackupManifest,
  now: number,
): Promise<{ mergeWarning?: string }> {
  const localFiles = await loadLocalScopedFileMap();
  const remoteFiles = await loadRemoteScopedFileMap(folderPath, remoteManifest);
  const review = buildSyncConflictReview(localFiles, remoteFiles);
  const choices = buildDefaultMergeChoices(review);
  await mergeConflictResolution(folderPath, remoteManifest, choices, now);
  const mergeWarning = mergeWarningFromReview(review);
  const localRevision = await computeRevision(getLocalDataDir(), DEFAULT_SYNC_SCOPES);
  await pushLocalToBackup(folderPath, localRevision, now);
  return { mergeWarning };
}

async function pushLocalToBackup(
  folder: string,
  localRevision: string,
  now: number,
): Promise<{ bundleHash: string }> {
  const { bytes, bundleHash } = await buildBundle(getLocalDataDir(), DEFAULT_SYNC_SCOPES);
  const contentRevision = await computeRevision(getLocalDataDir(), USER_CONTENT_SYNC_SCOPES);
  await mkdir(folder, { recursive: true });
  // Write bundle first, then manifest (so a partially-synced peer never sees
  // a manifest that points at an old or missing bundle). Both writes are
  // atomic via *.tmp + rename.
  await atomicWriteFile(join(folder, BUNDLE_FILENAME), bytes);
  const manifest: BackupManifest = {
    version: MANIFEST_VERSION,
    revision: localRevision,
    contentRevision,
    updatedAt: now,
    bundleHash,
  };
  await atomicWriteFile(
    join(folder, MANIFEST_FILENAME),
    Buffer.from(JSON.stringify(manifest, null, 2), "utf-8"),
  );
  return { bundleHash };
}

async function pullBackupIntoLocal(
  folder: string,
  manifest: BackupManifest,
  now: number,
): Promise<{ filesWritten: number }> {
  const bundlePath = join(folder, BUNDLE_FILENAME);
  const bytes = await readFile(bundlePath);
  const actualHash = hashBundleBytes(bytes);
  if (actualHash !== manifest.bundleHash) {
    throw new Error(
      "Backup bundle hash does not match its manifest — the bundle may still be syncing. Try again shortly.",
    );
  }
  const doc = parseBundle(bytes);
  const backupSnapshotDir = join(getLocalBackupsRoot(), String(now));
  const localData = getLocalDataDir();
  await backupScopedFiles(localData, backupSnapshotDir, DEFAULT_SYNC_SCOPES);
  return extractBundle(localData, doc, DEFAULT_SYNC_SCOPES);
}

let inFlight: Promise<SyncResult> | null = null;

function runExclusive(task: () => Promise<SyncResult>): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = task().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

export async function runSyncNow(): Promise<SyncResult> {
  return runExclusive(() => runSyncNowInner());
}

async function runSyncNowInner(): Promise<SyncResult> {
  const now = Date.now();
  const folderPath = await getBackupFolderPath();
  const folderCheck = await checkFolderAccessible(folderPath);
  const state = await loadState();
  const next: PersistedState = { ...state, lastAttemptAt: now, lastError: null };

  const conflictCopies = folderCheck.configured
    ? await listConflictCopies(folderPath)
    : [];

  if (!folderPath) {
    next.lastError = `Pick a backup folder in ${RIG_PAGE_TITLE}.`;
    await saveState(next);
    return {
      ok: false,
      status: buildStatus(next, folderPath, folderCheck, conflictCopies),
    };
  }
  if (!folderCheck.configured) {
    next.lastError = folderCheck.error ?? "Backup folder is not accessible.";
    await saveState(next);
    return {
      ok: false,
      status: buildStatus(next, folderPath, folderCheck, conflictCopies),
    };
  }

  const placeholderError = await bundlePlaceholderError(folderPath);
  if (placeholderError) {
    next.lastError = placeholderError;
    await saveState(next);
    return {
      ok: false,
      status: buildStatus(next, folderPath, folderCheck, conflictCopies),
    };
  }

  try {
    const remoteManifest = await readManifestFromBackup(folderPath);
    const localRevision = await computeRevision(getLocalDataDir(), DEFAULT_SYNC_SCOPES);
    const localContentRevision = await computeRevision(
      getLocalDataDir(),
      USER_CONTENT_SYNC_SCOPES,
    );

    if (!remoteManifest) {
      // Nothing in the backup folder yet (or unreadable manifest) → push.
      await pushLocalToBackup(folderPath, localRevision, now);
      next.lastSuccessAt = now;
      next.lastAction = "push";
      next.lastSyncedRevision = localRevision;
      next.lastSyncedContentRevision = localContentRevision;
      await saveState(next);
      return {
        ok: true,
        status: buildStatus(next, folderPath, folderCheck, conflictCopies),
      };
    }

    const localMaxMtimeMs = await computeLocalMaxMtime(
      getLocalDataDir(),
      USER_CONTENT_SYNC_SCOPES,
    );
    const remoteContentRevision = await readRemoteContentRevision(folderPath, remoteManifest);
    const decision = await resolveSyncDecision({
      localRevision,
      localContentRevision,
      remoteManifest,
      remoteContentRevision,
      lastSyncedRevision: state.lastSyncedRevision,
      lastSyncedContentRevision: state.lastSyncedContentRevision,
      localMaxMtimeMs,
    });

    if (decision === "conflict") {
      const { mergeWarning } = await autoMergeAndPush(folderPath, remoteManifest, now);
      const mergedRevision = await computeRevision(getLocalDataDir(), DEFAULT_SYNC_SCOPES);
      const mergedContentRevision = await computeRevision(
        getLocalDataDir(),
        USER_CONTENT_SYNC_SCOPES,
      );
      next.lastSuccessAt = now;
      next.lastAction = "merge";
      next.lastSyncedRevision = mergedRevision;
      next.lastSyncedContentRevision = mergedContentRevision;
      next.lastError = null;
      await saveState(next);
      return {
        ok: true,
        status: buildStatus(next, folderPath, folderCheck, conflictCopies),
        mergeWarning,
      };
    }

    return finishSyncAction({
      decision,
      folderPath,
      folderCheck,
      conflictCopies,
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
    return {
      ok: false,
      status: buildStatus(next, folderPath, folderCheck, conflictCopies),
    };
  }
}

async function pickBackupFolder(): Promise<string | null> {
  const win = BrowserWindow.getAllWindows()[0] ?? null;
  const result = await dialog.showOpenDialog(win ?? undefined, {
    title: "Choose backup folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const chosen = result.filePaths[0];
  await setSettings({ backup: { folderPath: chosen } });
  return chosen;
}

async function setBackupFolder(path: string): Promise<string | null> {
  const trimmed = path?.trim() ?? "";
  if (!trimmed) {
    await setSettings({ backup: { folderPath: "" } });
    return null;
  }
  // Try to create the folder so the user can accept a "Suggested" path even
  // if the cloud-sync provider hasn't created `Harness/` yet.
  try {
    await mkdir(trimmed, { recursive: true });
  } catch {
    // Surface the error via getStatus on the next read; don't throw here.
  }
  await setSettings({ backup: { folderPath: trimmed } });
  return trimmed;
}

async function revealBackupFolder(): Promise<void> {
  const folder = await getBackupFolderPath();
  if (!folder) return;
  await mkdir(folder, { recursive: true }).catch(() => undefined);
  await shell.openPath(folder);
}

function listSuggestions(): SyncFolderSuggestion[] {
  return listFolderSuggestions();
}

async function finishSyncAction(params: {
  decision: "push" | "pull" | "noop";
  folderPath: string;
  folderCheck: { configured: boolean; error: string | null };
  conflictCopies: string[];
  remoteManifest: BackupManifest;
  localRevision: string;
  localContentRevision: string;
  remoteContentRevision: string;
  now: number;
  state: PersistedState;
}): Promise<SyncResult> {
  const {
    decision,
    folderPath,
    folderCheck,
    conflictCopies,
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
    next.lastError = null;
    await saveState(next);
    return {
      ok: true,
      status: buildStatus(next, folderPath, folderCheck, conflictCopies),
    };
  }

  if (decision === "pull") {
    await pullBackupIntoLocal(folderPath, remoteManifest, now);
    next.lastSuccessAt = now;
    next.lastAction = "pull";
    next.lastSyncedRevision = remoteManifest.revision;
    next.lastSyncedContentRevision = remoteContentRevision;
    next.lastError = null;
    await saveState(next);
    return {
      ok: true,
      status: buildStatus(next, folderPath, folderCheck, conflictCopies),
    };
  }

  await pushLocalToBackup(folderPath, localRevision, now);
  next.lastSuccessAt = now;
  next.lastAction = "push";
  next.lastSyncedRevision = localRevision;
  next.lastSyncedContentRevision = localContentRevision;
  next.lastError = null;
  await saveState(next);
  return {
    ok: true,
    status: buildStatus(next, folderPath, folderCheck, conflictCopies),
  };
}

export function registerSyncHandlers(): void {
  ipcMain.handle("sync:getStatus", () => getSyncStatus());
  ipcMain.handle("sync:runNow", () => runSyncNow());
  ipcMain.handle("sync:pickFolder", () => pickBackupFolder());
  ipcMain.handle("sync:setFolder", (_e, path: string) => setBackupFolder(path));
  ipcMain.handle("sync:revealFolder", () => revealBackupFolder());
  ipcMain.handle("sync:listSuggestions", () => listSuggestions());
}

// Re-export so callers in main process don't need to know the path layout.
export { getLocalBackupsRoot };
