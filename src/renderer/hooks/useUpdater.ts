import { useCallback, useEffect, useState } from "react";
import { canStartUpdate, IDLE_UPDATE_STATUS, type UpdateStatus } from "../../shared/updateStatus";

/** App version + auto-update status for the sidebar footer. */
export function useUpdater() {
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(IDLE_UPDATE_STATUS);
  const [appVersion, setAppVersion] = useState<string | null>(null);

  useEffect(() => {
    window.harness.app.getVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  useEffect(() => {
    void window.harness.updater.getStatus().then(setUpdateStatus).catch(() => {});
    return window.harness.updater.onStatus(setUpdateStatus);
  }, []);

  const startUpdate = useCallback(() => {
    if (!canStartUpdate(updateStatus)) return;
    void window.harness.updater.downloadAndInstall().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setUpdateStatus({ status: "error", message: message || "Update failed" });
    });
  }, [updateStatus]);

  return { appVersion, updateStatus, startUpdate };
}
