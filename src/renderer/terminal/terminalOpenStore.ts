import { useCallback, useSyncExternalStore } from "react";

/**
 * Which conversations show their terminal panel. In memory only: the shells
 * themselves live in the backend and outlive this set.
 */
const openIds = new Set<string>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setTerminalOpen(conversationId: string, open: boolean): void {
  if (openIds.has(conversationId) === open) return;
  if (open) openIds.add(conversationId);
  else openIds.delete(conversationId);
  for (const listener of listeners) listener();
}

export function useTerminalOpen(
  conversationId: string | null,
): [open: boolean, toggle: () => void, setOpen: (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, () =>
    conversationId ? openIds.has(conversationId) : false,
  );
  const setOpen = useCallback(
    (next: boolean) => {
      if (conversationId) setTerminalOpen(conversationId, next);
    },
    [conversationId],
  );
  const toggle = useCallback(() => {
    if (conversationId) setTerminalOpen(conversationId, !openIds.has(conversationId));
  }, [conversationId]);
  return [open, toggle, setOpen];
}

/** Ctrl+` toggles the terminal, matching common editors. */
export function isTerminalToggleKey(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && e.code === "Backquote";
}
