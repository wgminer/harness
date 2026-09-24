/**
 * Q&A choice payload embedded in assistant markdown as a `::::options` fence.
 * The UI strips this from the bubble and shows choices in the composer dock.
 */

const OPTIONS_BLOCK_RE =
  /::::\s*options\b[^\n]*\n([\s\S]*?)\n::::\s*(?:\n|$)/gi;

const OPTION_TITLE_RE = /:::option\{[^}]*\btitle\s*=\s*"([^"]*)"[^}]*\}/gi;

/** Extract 2–4 option titles from a `::::options` … `::::` block. */
export function parseQaOptions(markdown: string): string[] {
  if (!markdown) return [];
  const titles: string[] = [];
  for (const match of markdown.matchAll(OPTIONS_BLOCK_RE)) {
    const body = match[1] ?? "";
    for (const opt of body.matchAll(OPTION_TITLE_RE)) {
      const title = (opt[1] ?? "").trim();
      if (title) titles.push(title);
    }
  }
  // Also accept orphan :::option lines (malformed / partial stream).
  if (titles.length === 0) {
    for (const opt of markdown.matchAll(OPTION_TITLE_RE)) {
      const title = (opt[1] ?? "").trim();
      if (title) titles.push(title);
    }
  }
  // Dedupe while preserving order; clamp to 2–4 for the dock.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const t of titles) {
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push(t);
  }
  if (unique.length < 2) return [];
  return unique.slice(0, 4);
}

/**
 * How long to wait after a Q&A turn ends before the chooser opens.
 * Matches `--motion-duration-expressive`: the question's ease-out fade has mostly landed.
 */
export const QA_CHOICE_REVEAL_DELAY_MS = 420;

export function qaChoiceRevealPlan(input: {
  justFinishedTurn: boolean;
  modeIsQa: boolean;
  prefersReducedMotion: boolean;
}): "immediate" | "hold" {
  if (!input.justFinishedTurn || !input.modeIsQa || input.prefersReducedMotion) return "immediate";
  return "hold";
}

/** Remove choice fences (and leftover option directives) so they never render in the bubble. */
export function stripQaOptions(markdown: string): string {
  if (!markdown) return markdown;
  let out = markdown.replace(OPTIONS_BLOCK_RE, "");
  // Leftover option containers / lines from partial fences or old messages.
  out = out.replace(/:::option\{[^}]*\}[\s\S]*?(?:\n:::\s*)?/gi, "");
  out = out.replace(/^::::\s*options\b.*$/gim, "");
  out = out.replace(/^::::\s*$/gm, "");
  out = out.replace(/^:::\s*$/gm, "");
  // Collapse excess blank lines left by stripping.
  out = out.replace(/\n{3,}/g, "\n\n").trimEnd();
  return out;
}
