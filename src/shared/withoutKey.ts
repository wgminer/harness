/** Copy of `record` without `key`, or the same object when the key is absent (keeps React state stable). */
export function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}
