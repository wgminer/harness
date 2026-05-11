/** Provider-agnostic backup-folder sync. */
export type SyncProvider = "folderBackup";

export type SyncDirection = "push" | "pull" | "noop";

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

export interface SyncResult {
  ok: boolean;
  status: SyncStatus;
}

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
