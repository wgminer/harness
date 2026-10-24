import { useCallback, useEffect, useState } from "react";
import type { SyncStatus } from "../../shared/sync";

const DISMISSED_ERROR_KEY = "harness.syncErrorDismissed";
const DISMISSED_EVENT = "harness:sync-error-dismissed";

function readDismissedError(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_ERROR_KEY);
  } catch {
    return null;
  }
}

/**
 * Current sync status, refreshed on mount and whenever sync reports a change.
 * `visibleError` hides an error the user dismissed until a different one shows up.
 */
export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [dismissedError, setDismissedError] = useState<string | null>(readDismissedError);

  const refresh = useCallback(() => {
    void window.harness.sync.getStatus().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
    return window.harness.sync.onChanged(refresh);
  }, [refresh]);

  useEffect(() => {
    const onDismissed = () => setDismissedError(readDismissedError());
    window.addEventListener(DISMISSED_EVENT, onDismissed);
    return () => window.removeEventListener(DISMISSED_EVENT, onDismissed);
  }, []);

  const lastError = status?.lastError ?? null;

  const dismissError = useCallback(() => {
    if (!lastError) return;
    try {
      window.localStorage.setItem(DISMISSED_ERROR_KEY, lastError);
    } catch {
      // Dismissal still holds for this window.
    }
    setDismissedError(lastError);
    window.dispatchEvent(new Event(DISMISSED_EVENT));
  }, [lastError]);

  const visibleError = lastError && lastError !== dismissedError ? lastError : null;

  return { status, refresh, visibleError, dismissError };
}
