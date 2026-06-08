/** Fixed quote shown on the compose-first new chat screen. */
export const HOME_HEADER_QUOTE = "You are here";

/** Rotating quote from numbered lines in the Clippings note. */

export function numberedListItems(content: string): string[] {
  return content.split("\n").flatMap((line) => {
    const trimmed = line.trim();
    const match = trimmed.match(/^\d+\.\s+/);
    if (!match) return [];
    return [trimmed.slice(match[0].length)];
  });
}

export function stripInlineTags(text: string): string {
  return text.replace(/\s+#\S+/g, "");
}

export function formatForHeader(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export function headerQuote(fromNoteContent: string, rotationIndex = 0): string {
  const pool = numberedListItems(fromNoteContent)
    .map((item) => formatForHeader(stripInlineTags(item)))
    .filter((item) => item.length > 0);
  if (pool.length === 0) return "";
  const index = ((rotationIndex % pool.length) + pool.length) % pool.length;
  return pool[index]!;
}

/** Day-based rotation index for header quotes. */
export function dayBasedQuoteRotationIndex(now = Date.now()): number {
  return Math.floor(now / 86_400_000);
}
