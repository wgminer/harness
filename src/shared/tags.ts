/**
 * Tags are normalized: trimmed, lowercased, internal runs of whitespace → single "_".
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

export function addTags(existing: string[], toAdd: unknown): string[] {
  return normalizeTags([...existing, ...normalizeTags(toAdd)]);
}

export function removeTags(existing: string[], toRemove: unknown): string[] {
  const drop = new Set(normalizeTags(toRemove));
  if (drop.size === 0) return normalizeTags(existing);
  return normalizeTags(existing).filter((t) => !drop.has(t));
}

export type TagPatch = {
  tags?: unknown;
  add_tags?: unknown;
  remove_tags?: unknown;
};

/** Apply optional tag replace / add / remove from tool or IPC args. */
export function applyTagPatch(existing: string[], patch: TagPatch): string[] | undefined {
  let next = normalizeTags(existing);
  let changed = false;

  if (patch.tags !== undefined && Array.isArray(patch.tags)) {
    const replaced = normalizeTags(patch.tags);
    if (JSON.stringify(replaced) !== JSON.stringify(next)) {
      next = replaced;
      changed = true;
    }
  }
  if (patch.add_tags !== undefined) {
    const merged = addTags(next, patch.add_tags);
    if (JSON.stringify(merged) !== JSON.stringify(next)) {
      next = merged;
      changed = true;
    }
  }
  if (patch.remove_tags !== undefined) {
    const trimmed = removeTags(next, patch.remove_tags);
    if (JSON.stringify(trimmed) !== JSON.stringify(next)) {
      next = trimmed;
      changed = true;
    }
  }

  return changed ? next : undefined;
}
