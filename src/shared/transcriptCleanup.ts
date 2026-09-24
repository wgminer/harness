/**
 * Transcript cleanup prompt + preferred-spellings glossary.
 * Contract: `resources/contracts/transcriptCleanup.json`.
 */

import contract from "../../resources/contracts/transcriptCleanup.json";

export interface TranscriptCleanupContract {
  defaultPrompt: string;
  legacyDefaultPrompt: string;
  preferredSpellingsHeader: string;
}

const parsed = contract as TranscriptCleanupContract;

export const DEFAULT_TRANSCRIPT_CLEANUP_PROMPT = parsed.defaultPrompt;
export const LEGACY_TRANSCRIPT_CLEANUP_PROMPT = parsed.legacyDefaultPrompt;
export const PREFERRED_SPELLINGS_HEADER = parsed.preferredSpellingsHeader;

export interface LegacyTranscriptDictionaryEntry {
  from?: unknown;
  to?: unknown;
}

export function migrateCleanupPrompt(prompt: unknown): string {
  const trimmed = typeof prompt === "string" ? prompt.trim() : "";
  if (!trimmed || trimmed === LEGACY_TRANSCRIPT_CLEANUP_PROMPT) {
    return DEFAULT_TRANSCRIPT_CLEANUP_PROMPT;
  }
  return trimmed;
}

export function normalizeGlossary(terms: unknown): string[] {
  if (!Array.isArray(terms)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of terms) {
    const term = typeof item === "string" ? item.trim() : "";
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

export function glossaryFromLegacyDictionary(dictionary: unknown): string[] {
  if (!Array.isArray(dictionary)) return [];
    const terms: string[] = [];
    for (const row of dictionary) {
      if (!row || typeof row !== "object") continue;
      const entry = row as LegacyTranscriptDictionaryEntry;
      const from = typeof entry.from === "string" ? entry.from.trim() : "";
      if (typeof entry.to === "string") {
        const to = entry.to.trim();
        if (to) terms.push(to);
        continue;
      }
      if (from) terms.push(from);
    }
  return normalizeGlossary(terms);
}

/** Prefer an explicit `glossary` key (even if empty) over legacy `dictionary`. */
export function resolveGlossary(transcription: unknown): string[] {
  if (!transcription || typeof transcription !== "object") return [];
  const raw = transcription as { glossary?: unknown; dictionary?: unknown };
  if (Object.prototype.hasOwnProperty.call(raw, "glossary")) {
    return normalizeGlossary(raw.glossary);
  }
  return glossaryFromLegacyDictionary(raw.dictionary);
}

export function mergeGlossary(
  partialTranscription: unknown,
  currentTranscription: unknown,
): string[] {
  if (partialTranscription && typeof partialTranscription === "object") {
    const partial = partialTranscription as { glossary?: unknown };
    if (Object.prototype.hasOwnProperty.call(partial, "glossary")) {
      return normalizeGlossary(partial.glossary);
    }
  }
  const fromCurrent = resolveGlossary(currentTranscription);
  if (fromCurrent.length > 0) return fromCurrent;
  return resolveGlossary(partialTranscription);
}

export function appendPreferredSpellings(prompt: string, glossary: string[]): string {
  const base = prompt.trim() || DEFAULT_TRANSCRIPT_CLEANUP_PROMPT;
  if (glossary.length === 0) return base;
  const lines = glossary.map((term) => `- ${term}`).join("\n");
  return `${base}\n\n${PREFERRED_SPELLINGS_HEADER}\n${lines}`;
}
