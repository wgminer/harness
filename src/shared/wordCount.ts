/** Count whitespace-separated words in `text` (empty/whitespace → 0). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** e.g. `1 word` / `1,234 words` */
export function formatWordCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "word" : "words"}`;
}
