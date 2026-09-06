/**
 * Compose-screen header quotes — from resources/contracts/homeHeaderQuotes.json.
 * Same list is bundled on iOS (`HeaderQuotePolicy`).
 */

import contract from "../../resources/contracts/homeHeaderQuotes.json";

export type HomeHeaderQuoteJob = "teach" | "intrigue" | "remind" | "center";

export interface HomeHeaderQuote {
  id: string;
  short: string;
  full: string;
  author: string;
  source: string;
  job: HomeHeaderQuoteJob;
  /** Lead-in sentence for the tooltip (setting). */
  context: string;
  /** Takeaway sentence shown after the lead-in. */
  moral: string;
}

interface HomeHeaderQuotesContract {
  quotes: HomeHeaderQuote[];
}

const FALLBACK_SHORT = "Begin";

const parsed = contract as HomeHeaderQuotesContract;

export const HOME_HEADER_QUOTES: readonly HomeHeaderQuote[] = parsed.quotes;

/** Default short line when callers want a fixed fallback. */
export const HOME_HEADER_QUOTE = HOME_HEADER_QUOTES[0]?.short ?? FALLBACK_SHORT;

export const HOME_HEADER_QUOTE_BAG_KEY = "harness.homeHeaderQuoteBag";

export interface HomeHeaderQuoteBagState {
  remaining: string[];
}

type BagStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function defaultStorage(): BagStorage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function quoteById(id: string): HomeHeaderQuote | undefined {
  return HOME_HEADER_QUOTES.find((q) => q.id === id);
}

function allQuoteIds(): string[] {
  return HOME_HEADER_QUOTES.map((q) => q.id);
}

/** Fisher–Yates shuffle (mutable copy). */
export function shuffleIds(ids: readonly string[], random: () => number = Math.random): string[] {
  const next = [...ids];
  for (let i = next.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const tmp = next[i]!;
    next[i] = next[j]!;
    next[j] = tmp;
  }
  return next;
}

function readBag(storage: BagStorage | null): HomeHeaderQuoteBagState {
  if (!storage) return { remaining: [] };
  try {
    const raw = storage.getItem(HOME_HEADER_QUOTE_BAG_KEY);
    if (!raw) return { remaining: [] };
    const parsedBag = JSON.parse(raw) as HomeHeaderQuoteBagState;
    if (!Array.isArray(parsedBag.remaining)) return { remaining: [] };
    const known = new Set(allQuoteIds());
    return {
      remaining: parsedBag.remaining.filter((id) => typeof id === "string" && known.has(id)),
    };
  } catch {
    return { remaining: [] };
  }
}

function writeBag(storage: BagStorage | null, state: HomeHeaderQuoteBagState): void {
  if (!storage) return;
  try {
    storage.setItem(HOME_HEADER_QUOTE_BAG_KEY, JSON.stringify(state));
  } catch {
    // Quota / private mode — ignore; bag resets next visit.
  }
}

export function homeHeaderQuoteAttribution(quote: HomeHeaderQuote): string {
  return [quote.author, quote.source].filter(Boolean).join(", ");
}

/** Context + moral as two sentences in one wrapping line. */
export function homeHeaderQuoteNote(quote: HomeHeaderQuote): string {
  return [quote.context, quote.moral].filter(Boolean).join(" ");
}

export function formatHomeHeaderQuoteTooltip(quote: HomeHeaderQuote): string {
  return [homeHeaderQuoteAttribution(quote), homeHeaderQuoteNote(quote)].filter(Boolean).join("\n");
}

/**
 * Draw the next compose quote from the per-device shuffle bag.
 * When the bag is empty, reshuffles all ids. Persists remaining ids.
 */
export function nextHomeHeaderQuote(options?: {
  storage?: BagStorage | null;
  random?: () => number;
}): HomeHeaderQuote {
  const storage = options?.storage === undefined ? defaultStorage() : options.storage;
  const random = options?.random ?? Math.random;
  const quotes = HOME_HEADER_QUOTES;
  if (quotes.length === 0) {
    return {
      id: "fallback",
      short: FALLBACK_SHORT,
      full: FALLBACK_SHORT,
      author: "",
      source: "",
      job: "center",
      context: "",
      moral: "",
    };
  }

  let { remaining } = readBag(storage);
  if (remaining.length === 0) {
    remaining = shuffleIds(allQuoteIds(), random);
  }

  const id = remaining[0]!;
  const rest = remaining.slice(1);
  writeBag(storage, { remaining: rest });

  return quoteById(id) ?? quotes[0]!;
}
