import { useCallback, useEffect, useMemo, useState } from "react";
import {
  inboxPendingCount,
  type InboxItem,
  type InboxProcessAction,
} from "../../shared/inbox";

/** Captures drained from the phone; reloads whenever a drain lands new ones. */
export function useInbox() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (op: () => Promise<InboxItem[]>) => {
    try {
      setItems(await op());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const reload = useCallback(() => run(() => window.harness.inbox.list()), [run]);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
    return window.harness.inbox.onChanged(() => {
      void reload();
    });
  }, [reload]);

  const refresh = useCallback(() => run(() => window.harness.inbox.refresh()), [run]);

  const updateText = useCallback(
    (id: string, text: string) => run(() => window.harness.inbox.updateText(id, text)),
    [run],
  );

  const process = useCallback(
    (id: string, action: InboxProcessAction) =>
      run(async () => (await window.harness.inbox.process(id, action)).items),
    [run],
  );

  const restore = useCallback((id: string) => run(() => window.harness.inbox.restore(id)), [run]);

  const clearProcessed = useCallback(
    () => run(() => window.harness.inbox.clearProcessed()),
    [run],
  );

  const pendingCount = useMemo(() => inboxPendingCount(items), [items]);

  return { items, loading, error, pendingCount, refresh, updateText, process, restore, clearProcessed };
}

export type InboxState = ReturnType<typeof useInbox>;
