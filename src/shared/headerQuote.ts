/**
 * Compose-screen header quotes — from resources/contracts/homeHeaderQuotes.json.
 * Same list is bundled on iOS (`HeaderQuotePolicy`).
 */

import contract from "../../resources/contracts/homeHeaderQuotes.json";

interface HomeHeaderQuotesContract {
  quotes: string[];
}

const parsed = contract as HomeHeaderQuotesContract;

export const HOME_HEADER_QUOTES: readonly string[] = parsed.quotes;

/** @deprecated Prefer `homeHeaderQuoteForDate()` — kept for callers that want a fixed default. */
export const HOME_HEADER_QUOTE = HOME_HEADER_QUOTES[0] ?? "You are here";

/** UTC day index (ms since epoch / day). Shared with iOS for same-day parity. */
export function utcDayIndex(date = new Date()): number {
  return Math.floor(date.getTime() / 86_400_000);
}

export function homeHeaderQuoteIndex(date = new Date()): number {
  const n = HOME_HEADER_QUOTES.length;
  if (n === 0) return 0;
  return ((utcDayIndex(date) % n) + n) % n;
}

/** Today's compose quote (rotates by UTC day across the shared list). */
export function homeHeaderQuoteForDate(date = new Date()): string {
  const quotes = HOME_HEADER_QUOTES;
  if (quotes.length === 0) return "You are here";
  return quotes[homeHeaderQuoteIndex(date)]!;
}
