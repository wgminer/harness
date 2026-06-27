/** Cloudflare R2 remote backup sync. */
export type SyncProvider = "s3Backup";

export type SyncDirection = "push" | "pull" | "noop" | "merge";

export type SyncDecision = SyncDirection | "conflict";

export interface SyncStatus {
  provider: SyncProvider;
  /** True when R2 account, bucket, access key id, and secret are configured. */
  configured: boolean;
  accountId: string | null;
  bucket: string | null;
  prefix: string | null;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  /** Last action performed by Sync now. */
  lastAction: SyncDirection | null;
  /** Local revision after the last successful sync. */
  lastSyncedRevision: string | null;
  /** Remote manifest revision last observed (for active polling UI). */
  remoteRevision: string | null;
  /** Human-readable sync status line for the UI. */
  statusLine: string | null;
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

export function formatSyncStatusLine(input: {
  lastSuccessAt: number | null;
  lastAction: SyncDirection | null;
  isSyncing: boolean;
  lastError: string | null;
  configured: boolean;
}): string | null {
  if (!input.configured) return "Connect R2 in Settings → Data to enable sync.";
  if (input.isSyncing) return "Syncing…";
  if (input.lastError) return input.lastError;
  if (input.lastSuccessAt) {
    const agoSec = Math.max(0, Math.round((Date.now() - input.lastSuccessAt) / 1000));
    const ago =
      agoSec < 60
        ? `${agoSec}s ago`
        : agoSec < 3600
          ? `${Math.round(agoSec / 60)}m ago`
          : `${Math.round(agoSec / 3600)}h ago`;
    if (input.lastAction === "pull") return `Pulled remote changes · synced ${ago}`;
    if (input.lastAction === "push") return `Pushed local changes · synced ${ago}`;
    if (input.lastAction === "merge") return `Merged changes · synced ${ago}`;
    return `Synced ${ago}`;
  }
  return "No sync completed yet.";
}
