import { useCallback, useEffect, useState } from "react";
import type { ParakeetStatus } from "../shared/parakeetStatus";
import { IDLE_PARAKEET_STATUS } from "../shared/parakeetStatus";

export function useParakeetModel() {
  const [status, setStatus] = useState<ParakeetStatus>(IDLE_PARAKEET_STATUS);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<NodeJS.Platform>("darwin");

  const refresh = useCallback(async () => {
    const p = await window.electron.system.getPlatform();
    setPlatform(p);
    if (p !== "darwin" || !window.electron.parakeet) {
      setInstalled(false);
      return { installed: false, status: IDLE_PARAKEET_STATUS };
    }
    const [s, isInstalled] = await Promise.all([
      window.electron.parakeet.getStatus(),
      window.electron.parakeet.isModelInstalled(),
    ]);
    setStatus(s);
    setInstalled(isInstalled);
    return { installed: isInstalled, status: s };
  }, []);

  useEffect(() => {
    void refresh();
    if (!window.electron.parakeet) return;
    const unsub = window.electron.parakeet.onStatus((s) => {
      setStatus(s);
      if (s.status === "ready") setInstalled(true);
    });
    return unsub;
  }, [refresh]);

  const download = useCallback(async () => {
    if (!window.electron.parakeet) return;
    await window.electron.parakeet.ensureModel();
    await refresh();
  }, [refresh]);

  const cancel = useCallback(async () => {
    if (!window.electron.parakeet) return;
    await window.electron.parakeet.cancelDownload();
    await refresh();
  }, [refresh]);

  const remove = useCallback(async () => {
    if (!window.electron.parakeet) return;
    await window.electron.parakeet.removeModel();
    setInstalled(false);
    await refresh();
  }, [refresh]);

  return {
    status,
    installed,
    platform,
    refresh,
    download,
    cancel,
    remove,
    isMac: platform === "darwin",
  };
}
