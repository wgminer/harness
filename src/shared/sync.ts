/** Provider-agnostic backup-folder sync. */
export type SyncProvider = "folderBackup";

export type SyncDirection = "push" | "pull" | "noop" | "merge";

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
  /** Last action performed by Sync now. */
  lastAction: SyncDirection | null;
  /** Local revision after the last successful sync. */
  lastSyncedRevision: string | null;
  /** Conflict-copy filenames detected in the backup folder (Dropbox / Drive style). */
  conflictCopies: string[];
}

export interface SyncResult {
  ok: boolean;
  status: SyncStatus;
  /** Non-blocking note when non-mergeable file conflicts kept the local copy. */
  mergeWarning?: string;
}

/** True when a successful sync wrote remote conversation data into local storage. */
export function syncResultChangedLocalData(result: SyncResult): boolean {
  if (!result.ok) return false;
  const action = result.status.lastAction;
  return action === "pull" || action === "merge";
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
