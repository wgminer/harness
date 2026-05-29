/** How user facts from `user_memory.json` are chosen for the system prompt. */
export type MemoryInjectionStrategy = "all" | "relevant" | "budget" | "none";

export const DEFAULT_MEMORY_INJECTION_STRATEGY: MemoryInjectionStrategy = "all";

export const MEMORY_INJECTION_STRATEGY_OPTIONS: Array<{
  id: MemoryInjectionStrategy;
  label: string;
  description: string;
}> = [
  {
    id: "all",
    label: "All facts",
    description: "Include every stored fact on each message (sorted by key).",
  },
  {
    id: "relevant",
    label: "Relevant to message",
    description: "Score facts against the current user message; include strong matches only (up to 6, ~900 chars).",
  },
  {
    id: "budget",
    label: "Alphabetical cap",
    description: "Include facts in key order until ~900 characters (no relevance scoring).",
  },
  {
    id: "none",
    label: "Off",
    description: "Do not inject user facts into the prompt (facts remain stored; model can still use memory tools).",
  },
];

const MEMORY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "we",
  "with",
  "you",
  "your",
]);

const MEMORY_ALWAYS_RELEVANT_KEY_PARTS = ["writing", "tone", "style", "voice", "goal", "audience", "constraint"];
const RELEVANT_MAX_ENTRIES = 6;
const RELEVANT_MAX_CHARS = 900;
const RELEVANT_MIN_SCORE = 0.65;
const BUDGET_MAX_CHARS = 900;
const RELEVANT_FALLBACK_COUNT = 3;

function toTokens(text: string): string[] {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 3 && !MEMORY_STOPWORDS.has(t));
}

function countOverlap(base: Set<string>, candidates: string[]): number {
  let count = 0;
  for (const token of candidates) {
    if (base.has(token)) count += 1;
  }
  return count;
}

function scoreMemoryEntry(key: string, value: string, userContent: string): number {
  const userTokens = new Set(toTokens(userContent));
  if (userTokens.size === 0) return 0;
  const keyTokens = toTokens(key);
  const valueTokens = toTokens(value);
  const keyMatches = countOverlap(userTokens, keyTokens);
  const valueMatches = countOverlap(userTokens, valueTokens);
  const tokenNorm = Math.sqrt(Math.max(1, keyTokens.length + valueTokens.length));
  let score = (keyMatches * 2 + valueMatches) / tokenNorm;
  const keyLower = key.toLowerCase();
  if (MEMORY_ALWAYS_RELEVANT_KEY_PARTS.some((part) => keyLower.includes(part))) score += 1;
  const extraChars = Math.max(0, value.length - 260);
  score -= (extraChars / 200) * 0.2;
  return score;
}

function sortedMemoryEntries(userMemory: Record<string, string>): Array<[key: string, value: string]> {
  return Object.entries(userMemory)
    .filter(([k]) => k.trim().length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}

function applyCharBudget(
  rows: Array<{ key: string; value: string }>,
  maxChars: number
): Array<[key: string, value: string]> {
  let usedChars = 0;
  const selected: Array<[string, string]> = [];
  for (const row of rows) {
    const nextLine = `- ${row.key}: ${row.value}`;
    if (selected.length > 0 && usedChars + nextLine.length > maxChars) break;
    selected.push([row.key, row.value]);
    usedChars += nextLine.length;
  }
  return selected;
}

function selectRelevantEntries(
  entries: Array<[key: string, value: string]>,
  userContent?: string
): Array<[key: string, value: string]> {
  if (!userContent?.trim()) return entries.slice(0, RELEVANT_FALLBACK_COUNT);

  const scored = entries
    .map(([key, value]) => ({ key, value, score: scoreMemoryEntry(key, value, userContent) }))
    .filter((row) => row.score >= RELEVANT_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, RELEVANT_MAX_ENTRIES);

  return applyCharBudget(scored, RELEVANT_MAX_CHARS);
}

function selectBudgetEntries(entries: Array<[key: string, value: string]>): Array<[key: string, value: string]> {
  return applyCharBudget(
    entries.map(([key, value]) => ({ key, value })),
    BUDGET_MAX_CHARS
  );
}

export function parseMemoryInjectionStrategy(raw: unknown): MemoryInjectionStrategy {
  if (raw === "all" || raw === "relevant" || raw === "budget" || raw === "none") return raw;
  return DEFAULT_MEMORY_INJECTION_STRATEGY;
}

/** Pick fact rows to embed in `[USER_MEMORY_CONTEXT]` for this request. */
export function selectMemoryEntriesForPrompt(
  strategy: MemoryInjectionStrategy,
  userMemory: Record<string, string>,
  userContent?: string
): Array<[key: string, value: string]> {
  if (strategy === "none") return [];
  const entries = sortedMemoryEntries(userMemory);
  if (entries.length === 0) return [];

  switch (strategy) {
    case "all":
      return entries;
    case "relevant":
      return selectRelevantEntries(entries, userContent);
    case "budget":
      return selectBudgetEntries(entries);
    default:
      return entries;
  }
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
