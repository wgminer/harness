/**
 * Library search — conversations, dictations, note titles, image titles.
 * Contract: resources/contracts/conversationSearch.json (mirrored in Rust / iOS).
 */

import contract from "../../resources/contracts/conversationSearch.json";
import {
  type ConversationListRow,
  conversationSidebarIconKind,
} from "./conversationSession";
import { stripSentAtPrefix } from "./recentConversations";

export type SearchResultKind = "chat" | "dictation" | "note" | "image";

export interface ConversationSearchContract {
  minTokenLength: number;
  stopwords: string[];
  weights: {
    titleToken: number;
    bodyToken: number;
    messageMatch: number;
    allTokensBonus: number;
  };
  toolResultCap: number;
  excerptBudget: number;
  excerptCount: number;
  snippetCharsBefore: number;
  snippetCharsAfter: number;
  snippetMaxLines: number;
  resultKinds: SearchResultKind[];
  hrefPrefixes: Record<SearchResultKind, string>;
}

export const CONVERSATION_SEARCH_CONTRACT = contract as ConversationSearchContract;

export interface SearchConversationCandidate {
  id: string;
  title: string | null;
  createdAt: number;
  sessionKind?: ConversationListRow["sessionKind"];
  hasAssistantReply?: boolean;
  hasMessages?: boolean;
  messages: Array<{ role: string; content: string; toolCalls?: unknown[] }>;
  activityAt?: number;
}

export interface SearchTitleCandidate {
  id: string;
  title: string;
  activityAt: number;
}

/** UI search row (Search page + IPC). */
export interface SearchResult {
  id: string;
  kind: SearchResultKind;
  title: string | null;
  createdAt: number;
  titleMatched: boolean;
  titleMatchRange: [number, number] | undefined;
  snippet: string;
  snippetMatchRange: [number, number];
  score: number;
}

/** Assistant tool hit — client renders tappable links from id + kind / href. */
export interface MemorySearchHit {
  kind: SearchResultKind;
  id: string;
  title: string;
  activityAt: number;
  score: number;
  matchCount?: number;
  excerpts?: string[];
  snippet?: string;
  href?: string;
}

export type LibraryRefTarget = "conversation" | "note" | "image";

export interface LibraryRef {
  target: LibraryRefTarget;
  id: string;
}

const LIBRARY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const BARE_CONVERSATION_ID = /^conv_[A-Za-z0-9_]+$/;

export function libraryHref(kind: SearchResultKind, id: string): string {
  return `${CONVERSATION_SEARCH_CONTRACT.hrefPrefixes[kind]}${id}`;
}

export function libraryRefFallbackLabel(target: LibraryRefTarget): string {
  switch (target) {
    case "note":
      return "Open note";
    case "image":
      return "Open image";
    default:
      return "Open chat";
  }
}

function libraryRefFromPrefix(path: string): LibraryRef | null {
  const prefixes = CONVERSATION_SEARCH_CONTRACT.hrefPrefixes;
  const candidates: Array<{ prefix: string; target: LibraryRefTarget }> = [
    { prefix: prefixes.note, target: "note" },
    { prefix: prefixes.image, target: "image" },
    { prefix: prefixes.chat, target: "conversation" },
    { prefix: prefixes.dictation, target: "conversation" },
  ];
  candidates.sort((a, b) => b.prefix.length - a.prefix.length);
  const seen = new Set<string>();
  for (const { prefix, target } of candidates) {
    if (seen.has(prefix)) continue;
    seen.add(prefix);
    if (!path.startsWith(prefix)) continue;
    let id = path.slice(prefix.length).trim();
    try {
      id = decodeURIComponent(id).trim();
    } catch {
      continue;
    }
    if (LIBRARY_ID_PATTERN.test(id)) return { target, id };
  }
  return null;
}

/** Parse `/c/id`, `/n/id`, `/i/id` (and bare `conv_*`) from model citations. */
export function parseLibraryHref(raw: string): LibraryRef | null {
  const value = raw.trim().replace(/^`+|`+$/g, "").trim();
  if (!value) return null;

  let path = value;
  if (/^[a-zA-Z][a-zA-Z+.-]*:/.test(value)) {
    try {
      path = new URL(value).pathname;
    } catch {
      /* keep raw path */
    }
  }

  return libraryRefFromPrefix(path) ?? (BARE_CONVERSATION_ID.test(path) ? { target: "conversation", id: path } : null);
}

export function tokenizeQuery(raw: string, cfg = CONVERSATION_SEARCH_CONTRACT): string[] {
  const stop = new Set(cfg.stopwords.map((w) => w.toLowerCase()));
  const tokens = raw
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim())
    .filter((t) => t.length >= cfg.minTokenLength && !stop.has(t));
  return [...new Set(tokens)];
}

function conversationKind(
  row: Pick<ConversationListRow, "title" | "sessionKind" | "hasAssistantReply">,
): "chat" | "dictation" {
  return conversationSidebarIconKind(row) === "dictation" ? "dictation" : "chat";
}

function findFirstTokenMatch(text: string, tokens: string[]): { index: number; token: string } | null {
  const lower = text.toLowerCase();
  for (const token of tokens) {
    const idx = lower.indexOf(token);
    if (idx >= 0) return { index: idx, token };
  }
  return null;
}

export function extractSnippet(
  content: string,
  matchIndex: number,
  matchLen: number,
  cfg = CONVERSATION_SEARCH_CONTRACT,
): { snippet: string; snippetMatchRange: [number, number] } {
  const windowStart = Math.max(0, matchIndex - cfg.snippetCharsBefore);
  const matchEndInContent = matchIndex + matchLen;
  let snippetEnd = Math.min(content.length, matchEndInContent + cfg.snippetCharsAfter);
  let snippetStart = windowStart;

  const before = content.slice(0, matchIndex);
  const lastNl = before.lastIndexOf("\n");
  if (lastNl >= windowStart) snippetStart = lastNl + 1;

  if (matchEndInContent < content.length) {
    const after = content.slice(matchEndInContent);
    const nextNl = after.indexOf("\n");
    if (nextNl >= 0) {
      const end = matchEndInContent + nextNl + 1;
      if (end <= snippetEnd) snippetEnd = end;
    }
  }

  let lineCount = 1;
  for (let i = snippetStart; i < snippetEnd; i += 1) {
    if (content[i] === "\n") lineCount += 1;
    if (lineCount >= cfg.snippetMaxLines) break;
  }
  if (lineCount >= cfg.snippetMaxLines) {
    const slice = content.slice(snippetStart);
    const firstNl = slice.indexOf("\n");
    if (firstNl >= 0) {
      const secondNl = slice.indexOf("\n", firstNl + 1);
      if (secondNl >= 0) {
        const end = snippetStart + secondNl + 1;
        if (end < snippetEnd) snippetEnd = end;
      }
    }
  }

  const snippet = content.slice(snippetStart, snippetEnd);
  const matchStartInSnippet = matchIndex - snippetStart;
  const matchEndInSnippet = matchStartInSnippet + matchLen;
  const clampedStart = Math.max(0, Math.min(matchStartInSnippet, snippet.length));
  const clampedEnd = Math.max(clampedStart, Math.min(matchEndInSnippet, snippet.length));
  return { snippet, snippetMatchRange: [clampedStart, clampedEnd] };
}

function scoreTokensInText(text: string, tokens: string[], perToken: number): number {
  if (tokens.length === 0 || !text.trim()) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  let matched = 0;
  for (const token of tokens) {
    if (lower.includes(token)) {
      score += perToken;
      matched += 1;
    }
  }
  if (matched === tokens.length && tokens.length > 1) {
    score += CONVERSATION_SEARCH_CONTRACT.weights.allTokensBonus;
  }
  return score;
}

function scoreConversationCandidate(
  candidate: SearchConversationCandidate,
  tokens: string[],
  cfg = CONVERSATION_SEARCH_CONTRACT,
): {
  score: number;
  titleMatched: boolean;
  titleMatchRange: [number, number] | undefined;
  snippet: string;
  snippetMatchRange: [number, number];
  matchCount: number;
  excerpts: string[];
} | null {
  if (tokens.length === 0) return null;

  const titleStr = candidate.title?.trim() ?? "";
  let score = scoreTokensInText(titleStr, tokens, cfg.weights.titleToken);
  const titleMatched = tokens.some((t) => titleStr.toLowerCase().includes(t));
  let titleMatchRange: [number, number] | undefined;
  if (titleMatched) {
    const hit = findFirstTokenMatch(titleStr, tokens);
    if (hit) titleMatchRange = [hit.index, hit.index + hit.token.length];
  }

  let matchCount = 0;
  const excerptSources: string[] = [];
  let bestSnippet = "";
  let bestSnippetRange: [number, number] = [-1, -1];

  for (const message of candidate.messages) {
    const stripped = stripSentAtPrefix(message.content.trim());
    if (!stripped) continue;
    const bodyScore = scoreTokensInText(stripped, tokens, cfg.weights.bodyToken);
    if (bodyScore > 0) {
      matchCount += 1;
      score += bodyScore + cfg.weights.messageMatch;
      excerptSources.push(stripped);
      if (bestSnippetRange[0] < 0) {
        const hit = findFirstTokenMatch(stripped, tokens);
        if (hit) {
          const extracted = extractSnippet(stripped, hit.index, hit.token.length, cfg);
          bestSnippet = extracted.snippet;
          bestSnippetRange = extracted.snippetMatchRange;
        }
      }
    }
  }

  if (score <= 0) return null;

  if (!bestSnippet && titleMatched) {
    const first = candidate.messages.find((m) => m.content.trim())?.content ?? "";
    const lines = first.split("\n").slice(0, cfg.snippetMaxLines).join("\n").trim();
    bestSnippet = lines || "No message content";
    bestSnippetRange = [-1, -1];
  } else if (!bestSnippet) {
    bestSnippet = excerptSources[0]?.slice(0, cfg.excerptBudget) ?? "";
    bestSnippetRange = [-1, -1];
  }

  const excerpts: string[] = [];
  for (const source of excerptSources.slice(0, cfg.excerptCount)) {
    const hit = findFirstTokenMatch(source, tokens);
    if (hit) {
      excerpts.push(extractSnippet(source, hit.index, hit.token.length, cfg).snippet);
    } else {
      excerpts.push(source.slice(0, cfg.excerptBudget));
    }
  }

  return {
    score,
    titleMatched,
    titleMatchRange,
    snippet: bestSnippet,
    snippetMatchRange: bestSnippetRange,
    matchCount,
    excerpts,
  };
}

function scoreTitleOnlyCandidate(
  candidate: SearchTitleCandidate,
  tokens: string[],
  cfg = CONVERSATION_SEARCH_CONTRACT,
): { score: number; titleMatchRange: [number, number] | undefined } | null {
  const score = scoreTokensInText(candidate.title, tokens, cfg.weights.titleToken);
  if (score <= 0) return null;
  const hit = findFirstTokenMatch(candidate.title, tokens);
  const titleMatchRange = hit ? ([hit.index, hit.index + hit.token.length] as [number, number]) : undefined;
  return { score, titleMatchRange };
}

export function searchConversations(
  candidates: SearchConversationCandidate[],
  query: string,
  options?: { excludeId?: string; requireMessages?: boolean },
): SearchResult[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const results: SearchResult[] = [];
  for (const candidate of candidates) {
    if (options?.excludeId && candidate.id === options.excludeId) continue;
    if (options?.requireMessages && candidate.hasMessages !== true && candidate.messages.length === 0) {
      continue;
    }
    const scored = scoreConversationCandidate(candidate, tokens);
    if (!scored) continue;
    results.push({
      id: candidate.id,
      kind: conversationKind(candidate),
      title: candidate.title,
      createdAt: candidate.createdAt,
      titleMatched: scored.titleMatched,
      titleMatchRange: scored.titleMatchRange,
      snippet: scored.snippet,
      snippetMatchRange: scored.snippetMatchRange,
      score: scored.score,
    });
  }

  results.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  return results;
}

export function searchTitleOnly(
  candidates: SearchTitleCandidate[],
  query: string,
  kind: "note" | "image",
): SearchResult[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const results: SearchResult[] = [];
  for (const candidate of candidates) {
    const scored = scoreTitleOnlyCandidate(candidate, tokens);
    if (!scored) continue;
    results.push({
      id: candidate.id,
      kind,
      title: candidate.title,
      createdAt: candidate.activityAt,
      titleMatched: true,
      titleMatchRange: scored.titleMatchRange,
      snippet: candidate.title,
      snippetMatchRange: scored.titleMatchRange ?? [-1, -1],
      score: scored.score,
    });
  }

  results.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
  return results;
}

export function buildMemorySearchHits(
  conversations: SearchConversationCandidate[],
  notes: SearchTitleCandidate[],
  images: SearchTitleCandidate[],
  query: string,
  options?: { excludeConversationId?: string },
): MemorySearchHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const cfg = CONVERSATION_SEARCH_CONTRACT;
  const hits: MemorySearchHit[] = [];

  for (const candidate of conversations) {
    if (options?.excludeConversationId && candidate.id === options.excludeConversationId) continue;
    if (candidate.hasMessages !== true && candidate.messages.length === 0) continue;
    const scored = scoreConversationCandidate(candidate, tokens, cfg);
    if (!scored) continue;
    const kind = conversationKind(candidate);
    hits.push({
      kind,
      id: candidate.id,
      title: candidate.title?.trim() || "Untitled chat",
      activityAt: candidate.activityAt ?? candidate.createdAt,
      score: scored.score,
      matchCount: scored.matchCount,
      excerpts: scored.excerpts.length > 0 ? scored.excerpts : undefined,
      snippet: scored.snippet || undefined,
      href: libraryHref(kind, candidate.id),
    });
  }

  for (const candidate of notes) {
    const scored = scoreTitleOnlyCandidate(candidate, tokens, cfg);
    if (!scored) continue;
    hits.push({
      kind: "note",
      id: candidate.id,
      title: candidate.title,
      activityAt: candidate.activityAt,
      score: scored.score,
      snippet: candidate.title,
      href: libraryHref("note", candidate.id),
    });
  }

  for (const candidate of images) {
    const scored = scoreTitleOnlyCandidate(candidate, tokens, cfg);
    if (!scored) continue;
    hits.push({
      kind: "image",
      id: candidate.id,
      title: candidate.title,
      activityAt: candidate.activityAt,
      score: scored.score,
      snippet: candidate.title,
      href: libraryHref("image", candidate.id),
    });
  }

  hits.sort((a, b) => b.score - a.score || b.activityAt - a.activityAt);
  return hits.slice(0, cfg.toolResultCap);
}

export function memorySearchHitsFromPayload(payload: unknown): MemorySearchHit[] {
  if (!payload || typeof payload !== "object") return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const hit = row as MemorySearchHit;
    if (
      typeof hit.id !== "string" ||
      typeof hit.title !== "string" ||
      typeof hit.activityAt !== "number" ||
      typeof hit.score !== "number" ||
      (hit.kind !== "chat" &&
        hit.kind !== "dictation" &&
        hit.kind !== "note" &&
        hit.kind !== "image")
    ) {
      return [];
    }
    return [
      {
        ...hit,
        href: typeof hit.href === "string" && hit.href ? hit.href : libraryHref(hit.kind, hit.id),
      },
    ];
  });
}
