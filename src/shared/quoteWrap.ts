/**
 * Balance a centered quote so it does not wrap as a long first line
 * plus a short orphan. Shrinks the line budget until the text still
 * fits in the same number of lines, then greedy-wraps at that width.
 *
 * Default char budget matches `.new-chat-quote` (400px at 12px UI type)
 * with a little slack so a measured line does not re-wrap in CSS.
 */

/** ~400px / 12px SF Pro, leaving room for “ ” around the quote. */
export const NEW_CHAT_QUOTE_MAX_LINE_CHARS = 48;

export function balanceQuoteWrap(
  text: string,
  maxLineChars: number = NEW_CHAT_QUOTE_MAX_LINE_CHARS,
): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";

  const full = words.join(" ");
  if (full.length <= maxLineChars) return full;

  const lineCount = countLines(words, maxLineChars);
  const width = tightestWidth(words, lineCount, maxLineChars);
  return greedyWrap(words, width);
}

function countLines(words: readonly string[], width: number): number {
  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (used === 0) {
      used = word.length;
      continue;
    }
    if (used + 1 + word.length <= width) {
      used += 1 + word.length;
    } else {
      lines += 1;
      used = word.length;
    }
  }
  return lines;
}

function canFit(words: readonly string[], width: number, maxLines: number): boolean {
  return countLines(words, width) <= maxLines;
}

/** Smallest max line length that still wraps into `lineCount` lines. */
function tightestWidth(words: readonly string[], lineCount: number, maxWidth: number): number {
  let lo = 1;
  for (const word of words) lo = Math.max(lo, word.length);
  let hi = maxWidth;
  if (!canFit(words, hi, lineCount)) return maxWidth;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (canFit(words, mid, lineCount)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

function greedyWrap(words: readonly string[], width: number): string {
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}
