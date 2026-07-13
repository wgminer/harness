import { listen, type UnlistenFn } from "@tauri-apps/api/event";

type EventHub = {
  handlers: Set<(payload: unknown) => void>;
  /** Retained so HMR / tests can tear down; never removed on unsubscribe. */
  unlisten: UnlistenFn | null;
};

/**
 * One Tauri `listen` per wire event for the lifetime of the module.
 *
 * Handlers are added/removed on subscribe/unsubscribe. We intentionally do
 * **not** unlisten when the last handler leaves: disposing and recreating
 * races with React Strict Mode remounts and leaves stacked listeners that
 * double-deliver stream chunks.
 */
const eventHubs = new Map<string, EventHub>();

type ListenFn = typeof listen;

/** @internal test seam */
export function resetEventHubsForTests(): void {
  for (const hub of eventHubs.values()) {
    void hub.unlisten?.();
  }
  eventHubs.clear();
}

export function subscribeToWire<T>(
  wireName: string,
  handler: (payload: T) => void,
  listenFn: ListenFn = listen,
): () => void {
  let hub = eventHubs.get(wireName);
  if (!hub) {
    hub = { handlers: new Set(), unlisten: null };
    eventHubs.set(wireName, hub);
    const hubRef = hub;
    void listenFn<T>(wireName, (e) => {
      for (const h of hubRef.handlers) {
        h(e.payload);
      }
    }).then((fn) => {
      hubRef.unlisten = fn;
    });
  }

  const wrapped = handler as (payload: unknown) => void;
  hub.handlers.add(wrapped);
  return () => {
    hub.handlers.delete(wrapped);
  };
}
