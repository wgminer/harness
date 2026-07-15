/**
 * Canonical JSON for sync-merge output and cross-platform revision hashes.
 *
 * Format: 2-space pretty-print (or compact for dedup stamps), object keys sorted
 * lexicographically at every nesting level, no trailing newline.
 *
 * Changing this format changes revision hashes once — devices must re-pull.
 */

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortValue(obj[key]);
    }
    return sorted;
  }
  return value;
}

/** Pretty JSON with sorted keys (2-space indent, no trailing newline). */
export function canonicalJsonPretty(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

/** Compact JSON with sorted keys (for message dedup stamps). */
export function canonicalJsonCompact(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
