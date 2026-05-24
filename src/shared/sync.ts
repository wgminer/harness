/** Provider-agnostic backup-folder sync. */
export type SyncProvider = "folderBackup";

export type SyncDirection = "push" | "pull" | "noop";

/** User choice when local and backup have both diverged since the last sync. */
export type SyncConflictResolution = "push" | "pull" | { mode: "merge"; choices: Record<string, import("./syncMerge").SyncFileChoice> };

export type SyncDecision = SyncDirection | "conflict";

export interface SyncStatus {
  provider: SyncProvider;
  /** True when the user has selected a backup folder that currently exists/accessible. */
  configured: boolean;
  /** Persisted absolute folder path (or null if never set). */
  backupFolderPath: string | null;
  /** Resolved error if the path is set but inaccessible (e.g. unmounted volume). */
  folderError: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  /** Last action performed by Sync now (push wrote to backup, pull restored from backup). */
  lastAction: SyncDirection | null;
  /** Local revision after the last successful sync. */
  lastSyncedRevision: string | null;
  /** Conflict-copy filenames detected in the backup folder (Dropbox / Drive style). */
  conflictCopies: string[];
}

/** Returned when local and backup both changed — the user must pick a winner. */
export interface SyncConflict {
  localRevision: string;
  remoteRevision: string;
  remoteUpdatedAt: number;
  lastSyncedRevision: string | null;
  /** Latest mtime among synced local files (ms since epoch). */
  localMaxMtimeMs: number;
}

export interface SyncResult {
  ok: boolean;
  status: SyncStatus;
  /** Set when `ok` is false because both sides changed since the last sync. */
  conflict?: SyncConflict;
}

/**
 * Decide how to reconcile local data with the backup manifest.
 *
 * Uses the last synced revision as the common ancestor: only-remote-changed
 * pulls, only-local-changed pushes, both-changed conflicts. When this device
 * has never synced, a pull is safe unless local files were edited after the
 * backup was last written.
 */
export function decideSyncAction(params: {
  localRevision: string;
  remoteRevision: string | null;
  lastSyncedRevision: string | null;
  remoteUpdatedAt: number | null;
  localMaxMtimeMs: number;
}): SyncDecision {
  const { localRevision, remoteRevision, lastSyncedRevision, remoteUpdatedAt, localMaxMtimeMs } =
    params;

  if (!remoteRevision) return "push";
  if (localRevision === remoteRevision) return "noop";

  if (lastSyncedRevision !== null) {
    if (localRevision === lastSyncedRevision) return "pull";
    if (remoteRevision === lastSyncedRevision) return "push";
    return "conflict";
  }

  if (remoteUpdatedAt !== null && localMaxMtimeMs > remoteUpdatedAt) return "conflict";
  return "pull";
}

export {
  buildDefaultMergeChoices,
  buildMergedFileMap,
  buildSyncConflictReview,
  type SyncConflictFileEntry,
  type SyncConflictReview,
  type SyncFileChoice,
  type SyncFileChangeKind,
} from "./syncMerge";

/**
 * Suggested backup-folder paths for known cloud-sync providers on this OS.
 * Returned by `sync:listSuggestions` so the UI can offer convenience picks
 * without depending on any provider-specific behavior.
 */
export interface SyncFolderSuggestion {
  /** Human-readable label shown in the picker (e.g. "iCloud Drive"). */
  label: string;
  /** Absolute path the suggestion would resolve to. */
  path: string;
  /** True if the suggested parent already exists on disk. */
  exists: boolean;
}
