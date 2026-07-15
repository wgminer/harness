/** All stored facts, sorted by key, for `[USER_MEMORY_CONTEXT]` injection. */
export function sortedMemoryEntries(
  userMemory: Record<string, string>
): Array<[key: string, value: string]> {
  return Object.entries(userMemory)
    .filter(([k]) => k.trim().length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

export function formatMemoryContextBlock(selected: Array<[key: string, value: string]>): string {
  if (selected.length === 0) return "";
  return [
    "[USER_MEMORY_CONTEXT]",
    "Use only if relevant to the current request.",
    ...selected.map(([k, v]) => `- ${k}: ${v}`),
    "",
    "[MEMORY_RULES]",
    "- Treat memory as hints, not absolute truth.",
    "- If memory conflicts with the user's current message, follow the current message.",
    "- If uncertain whether memory still applies, ask one brief clarifying question.",
  ].join("\n");
}
