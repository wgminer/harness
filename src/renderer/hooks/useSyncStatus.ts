import { useCallback, useEffect, useState } from "react";
import type { SyncStatus } from "../../shared/sync";

/** Current sync status, refreshed on mount and whenever sync reports a change. */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);

  const refresh = useCallback(() => {
    void window.harness.sync.getStatus().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
    return window.harness.sync.onChanged(refresh);
  }, [refresh]);

  return { status, refresh };
}
