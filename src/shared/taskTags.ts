/**
 * Task tags are normalized: trimmed, lowercased, internal runs of whitespace → single "_".
 * Empty segments are dropped; order is preserved; duplicates removed (first wins).
 */
export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of input) {
    const t = String(x ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_");
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

const LEGACY_STATUSES = new Set(["pending", "in_progress", "completed", "cancelled"]);

/** Tags shown in the Tasks UI (excludes workflow/status labels). */
export function taskTagsWithoutLegacyStatus(tags: string[]): string[] {
  return normalizeTags(tags).filter((t) => !LEGACY_STATUSES.has(t));
}

/** Merge edited custom tags with existing status tags (pending, completed, etc.). */
export function mergeCustomTaskTags(existingTags: string[], customTags: string[]): string[] {
  const norm = normalizeTags(existingTags);
  const legacy = norm.filter((t) => LEGACY_STATUSES.has(t));
  return normalizeTags([...legacy, ...customTags]);
}

export function tagsFromLegacyStatus(status: unknown): string[] | null {
  if (typeof status !== "string") return null;
  const s = status.trim().toLowerCase();
  if (!LEGACY_STATUSES.has(s)) return null;
  return [s];
}

/** Coerce persisted or incoming task data to a non-empty tag list. */
export function coerceTaskTags(record: Record<string, unknown>): string[] {
  let tags = normalizeTags(record.tags);
  if (tags.length === 0) {
    const fromStatus = tagsFromLegacyStatus(record.status);
    if (fromStatus) tags = fromStatus;
  }
  if (tags.length === 0) return ["pending"];
  return tags;
}

export function taskHasTag(tags: string[], tag: string): boolean {
  const needle = tag.trim().toLowerCase();
  return normalizeTags(tags).includes(needle);
}

export function taskIsDone(tags: string[]): boolean {
  return taskHasTag(tags, "completed");
}

export function taskIsClearable(tags: string[]): boolean {
  const t = normalizeTags(tags);
  return t.includes("completed") || t.includes("cancelled");
}

export function toggleCompletedTag(tags: string[]): string[] {
  const norm = normalizeTags(tags);
  if (norm.includes("completed")) return norm.filter((x) => x !== "completed");
  return [...norm, "completed"];
}
