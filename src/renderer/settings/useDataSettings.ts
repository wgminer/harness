import { useState, useEffect, useCallback } from "react";
import type { SyncStatus } from "../../shared/sync";
import { syncResultChangedLocalData, syncNowButtonTooltip, syncInlineStatusLine } from "../../shared/sync";
import type { ClaudeImportPreview } from "./ClaudeImportModal";

export type DataStatus = {
  localDataDir: string;
  appStateDir: string;
  localDataExists: boolean;
  conversationsCount: number;
  messageFilesCount: number;
  notesFilesCount: number;
  hasSettingsFile: boolean;
  recordingsDir: string;
  recordingsLocalOnly: true;
  legacyMemoryDir: string;
  legacyMemoryExists: boolean;
  sync: SyncStatus;
};

export function useDataSettings(options: {
  onSyncComplete?: () => void;
  onImportComplete?: () => void;
}) {
  const { onSyncComplete, onImportComplete } = options;

  const [cleanupLegacyBusy, setCleanupLegacyBusy] = useState(false);
  const [cleanupLegacyMessage, setCleanupLegacyMessage] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncTestBusy, setSyncTestBusy] = useState(false);
  const [r2TestError, setR2TestError] = useState<string | null>(null);
  const [syncQrOpen, setSyncQrOpen] = useState(false);
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
  const [importStatus, setImportStatus] = useState<{ imported: number; errors: string[] } | null>(null);
  const [importing, setImporting] = useState(false);
  const [claudeImportStatus, setClaudeImportStatus] = useState<{
    imported: number;
    updated: number;
    errors: string[];
  } | null>(null);
  const [claudeImporting, setClaudeImporting] = useState(false);
  const [claudePreview, setClaudePreview] = useState<ClaudeImportPreview | null>(null);
  const [claudeSelectedIds, setClaudeSelectedIds] = useState<Set<string>>(new Set());
  const [claudeConfirming, setClaudeConfirming] = useState(false);

  const refreshDataStatus = useCallback(async () => {
    const status = await window.harness.memory.getDataStatus();
    setDataStatus(status);
  }, []);

  useEffect(() => {
    void refreshDataStatus();
  }, [refreshDataStatus]);

  useEffect(() => {
    if (!dataStatus?.sync.configured) return;
    const timer = setInterval(() => {
      void refreshDataStatus();
    }, 15_000);
    return () => clearInterval(timer);
  }, [dataStatus?.sync.configured, refreshDataStatus]);

  const runCleanupLegacyMemory = useCallback(async () => {
    setCleanupLegacyBusy(true);
    setCleanupLegacyMessage(null);
    try {
      const result = await window.harness.memory.cleanupLegacyMemory();
      setCleanupLegacyMessage(result.removed ? "Removed legacy memory folder." : "No legacy memory folder to remove.");
      await refreshDataStatus();
    } finally {
      setCleanupLegacyBusy(false);
    }
  }, [refreshDataStatus]);

  const runSyncNow = useCallback(async () => {
    setSyncBusy(true);
    try {
      const result = await window.harness.sync.runNow();
      await refreshDataStatus();
      if (syncResultChangedLocalData(result)) {
        onSyncComplete?.();
      }
    } finally {
      setSyncBusy(false);
    }
  }, [onSyncComplete, refreshDataStatus]);

  const testR2Connection = useCallback(async () => {
    setSyncTestBusy(true);
    setR2TestError(null);
    try {
      const result = await window.harness.sync.testConnection();
      if (result.ok) {
        await refreshDataStatus();
      } else {
        setR2TestError(result.error ?? "Connection failed.");
      }
    } finally {
      setSyncTestBusy(false);
    }
  }, [refreshDataStatus]);

  const syncTooltip = syncNowButtonTooltip({
    busy: syncBusy,
    configured: dataStatus?.sync.configured ?? false,
  });

  const syncInlineStatus =
    dataStatus?.sync.configured && !dataStatus.sync.lastError
      ? syncBusy
        ? "Syncing…"
        : syncInlineStatusLine({ lastSuccessAt: dataStatus.sync.lastSuccessAt ?? null })
      : null;

  const runImport = useCallback(async () => {
    setImporting(true);
    setImportStatus(null);
    try {
      const result = await window.harness.memory.importFromChatGPTFolder();
      setImportStatus(result);
      if (result.imported > 0) onImportComplete?.();
    } catch (e) {
      setImportStatus({
        imported: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setImporting(false);
    }
  }, [onImportComplete]);

  const closeClaudePreview = useCallback(() => {
    if (claudeConfirming) return;
    setClaudePreview(null);
    setClaudeSelectedIds(new Set());
  }, [claudeConfirming]);

  const runClaudeImport = useCallback(async () => {
    setClaudeImporting(true);
    setClaudeImportStatus(null);
    setClaudePreview(null);
    setClaudeSelectedIds(new Set());
    try {
      const result = await window.harness.memory.previewClaudeImport();
      if (result.folderPath == null) {
        return;
      }
      if (result.errors.length > 0 && result.conversations.length === 0 && result.found === 0) {
        setClaudeImportStatus({ imported: 0, updated: 0, errors: result.errors });
        return;
      }
      setClaudePreview({
        folderPath: result.folderPath,
        found: result.found,
        alreadyImported: result.alreadyImported,
        conversations: result.conversations,
        errors: result.errors,
      });
      // Prefer new threads; if everything is already imported, select all so a
      // re-import can refresh message timestamps / model labels.
      const fresh = result.conversations.filter((c) => !c.alreadyImported);
      const initial = fresh.length > 0 ? fresh : result.conversations;
      setClaudeSelectedIds(new Set(initial.map((c) => c.claudeId)));
    } catch (e) {
      setClaudeImportStatus({
        imported: 0,
        updated: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setClaudeImporting(false);
    }
  }, []);

  const toggleClaudeSelected = useCallback((claudeId: string) => {
    setClaudeSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(claudeId)) next.delete(claudeId);
      else next.add(claudeId);
      return next;
    });
  }, []);

  const selectAllClaude = useCallback(() => {
    if (!claudePreview) return;
    setClaudeSelectedIds(new Set(claudePreview.conversations.map((c) => c.claudeId)));
  }, [claudePreview]);

  const selectNoneClaude = useCallback(() => {
    setClaudeSelectedIds(new Set());
  }, []);

  const confirmClaudeImport = useCallback(async () => {
    if (!claudePreview) return;
    const ids = [...claudeSelectedIds];
    if (ids.length === 0) return;
    setClaudeConfirming(true);
    try {
      const result = await window.harness.memory.confirmClaudeImport(claudePreview.folderPath, ids);
      setClaudeImportStatus(result);
      setClaudePreview(null);
      setClaudeSelectedIds(new Set());
      if (result.imported > 0 || result.updated > 0) onImportComplete?.();
      await refreshDataStatus();
    } catch (e) {
      setClaudeImportStatus({
        imported: 0,
        updated: 0,
        errors: [e instanceof Error ? e.message : String(e)],
      });
    } finally {
      setClaudeConfirming(false);
    }
  }, [claudePreview, claudeSelectedIds, onImportComplete, refreshDataStatus]);

  return {
    dataStatus,
    refreshDataStatus,
    cleanupLegacyBusy,
    cleanupLegacyMessage,
    runCleanupLegacyMemory,
    syncBusy,
    syncTestBusy,
    r2TestError,
    syncQrOpen,
    setSyncQrOpen,
    syncTooltip,
    syncInlineStatus,
    runSyncNow,
    testR2Connection,
    importStatus,
    importing,
    runImport,
    claudeImportStatus,
    claudeImporting,
    runClaudeImport,
    claudePreview,
    claudeSelectedIds,
    claudeConfirming,
    closeClaudePreview,
    toggleClaudeSelected,
    selectAllClaude,
    selectNoneClaude,
    confirmClaudeImport,
  };
}
