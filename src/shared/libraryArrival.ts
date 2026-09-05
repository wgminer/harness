/** Library rows that just arrived from a remote pull/merge. */

export const LIBRARY_ARRIVAL_TTL_MS = 90_000;

export type LibraryArrivalFingerprint = {
  id: string;
  stamp: string;
};

export function conversationArrivalStamp(row: {
  id: string;
  title?: string | null;
  createdAt?: number;
  hasAssistantReply?: boolean;
  hasMessages?: boolean;
}): LibraryArrivalFingerprint {
  return {
    id: row.id,
    stamp: [
      row.title ?? "",
      String(row.createdAt ?? 0),
      row.hasAssistantReply === true ? "1" : "0",
      row.hasMessages === true ? "1" : "0",
    ].join("\0"),
  };
}

export function noteArrivalStamp(row: {
  id: string;
  updatedAt?: number;
  title?: string;
}): LibraryArrivalFingerprint {
  return {
    id: row.id,
    stamp: `${row.title ?? ""}\0${row.updatedAt ?? 0}`,
  };
}

export function snapshotLibraryFingerprints(input: {
  conversations: Array<{
    id: string;
    title?: string | null;
    createdAt?: number;
    hasAssistantReply?: boolean;
    hasMessages?: boolean;
  }>;
  notes: Array<{ id: string; updatedAt?: number; title?: string }>;
  images: Array<{ id: string; updatedAt?: number; title?: string }>;
}): LibraryArrivalFingerprint[] {
  return [
    ...input.conversations.map(conversationArrivalStamp),
    ...input.notes.map(noteArrivalStamp),
    ...input.images.map(imageArrivalStamp),
  ];
}

export function imageArrivalStamp(row: {
  id: string;
  updatedAt?: number;
  title?: string;
}): LibraryArrivalFingerprint {
  return {
    id: row.id,
    stamp: `${row.title ?? ""}\0${row.updatedAt ?? 0}`,
  };
}

/** New ids, or existing ids whose stamp changed (title/messages/updatedAt). */
export function arrivedLibraryIds(
  before: LibraryArrivalFingerprint[],
  after: LibraryArrivalFingerprint[],
): string[] {
  const prev = new Map(before.map((item) => [item.id, item.stamp]));
  const ids: string[] = [];
  for (const item of after) {
    const prior = prev.get(item.id);
    if (prior === undefined || prior !== item.stamp) {
      ids.push(item.id);
    }
  }
  return ids;
}

export function mergeArrivalTimes(
  current: Record<string, number>,
  ids: string[],
  now: number = Date.now(),
): Record<string, number> {
  const next = pruneArrivalTimes(current, now);
  for (const id of ids) {
    next[id] = now;
  }
  return next;
}

export function pruneArrivalTimes(
  current: Record<string, number>,
  now: number = Date.now(),
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [id, at] of Object.entries(current)) {
    if (now - at < LIBRARY_ARRIVAL_TTL_MS) {
      next[id] = at;
    }
  }
  return next;
}

export function consumeArrivalId(
  current: Record<string, number>,
  id: string,
): Record<string, number> {
  if (!(id in current)) return current;
  const next = { ...current };
  delete next[id];
  return next;
}
