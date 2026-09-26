import { useEffect } from "react";

async function runBackgroundSync() {
  const status = await window.harness.sync.getStatus();
  if (!status.configured) return;
  await window.harness.sync.runNow();
}

/** Sync on launch and window focus; call `onChanged` whenever a sync lands new data. */
export function useBackgroundSync(onChanged: () => void) {
  useEffect(() => {
    void runBackgroundSync();
    const onFocus = () => {
      void runBackgroundSync();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  useEffect(() => window.harness.sync.onChanged(onChanged), [onChanged]);
}
