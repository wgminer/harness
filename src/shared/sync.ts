export interface SyncStatus {
  provider: "firebase";
  configured: boolean;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastUploadedRevision: string | null;
}

export interface SyncResult {
  ok: boolean;
  status: SyncStatus;
}
