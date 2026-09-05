type Handler<T> = (payload: T) => void;

const listeners = new Map<string, Set<Handler<unknown>>>();

export function onBrowserEvent<T>(name: string, handler: Handler<T>): () => void {
  let set = listeners.get(name);
  if (!set) {
    set = new Set();
    listeners.set(name, set);
  }
  const wrapped = handler as Handler<unknown>;
  set.add(wrapped);
  return () => {
    set?.delete(wrapped);
    if (set && set.size === 0) listeners.delete(name);
  };
}

export function emitBrowserEvent<T>(name: string, payload: T): void {
  const set = listeners.get(name);
  if (!set) return;
  for (const handler of [...set]) {
    handler(payload);
  }
}

/** Tests only. */
export function resetBrowserEvents(): void {
  listeners.clear();
}
