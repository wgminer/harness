/**
 * Dictation reply-strip actions — from resources/contracts/dictationSuggestedPrompts.json.
 */

import contract from "../../resources/contracts/dictationSuggestedPrompts.json";

export type DictationVocabWord = "Summarize" | "Distill" | "Breakdown" | "Proofread";
export type DictationReplyAction = "run" | DictationVocabWord;

export interface DictationSuggestedPromptsContract {
  systemPrompt: string;
  vocabulary: string[];
  runAction: string;
  maxPrompts: number;
  maxCompletionTokens: number;
  timeoutSecs: number;
}

const parsed = contract as DictationSuggestedPromptsContract;

export const DICTATION_SUGGEST_SYSTEM_PROMPT = parsed.systemPrompt;
export const DICTATION_SUGGEST_VOCABULARY = parsed.vocabulary as DictationVocabWord[];
export const DICTATION_REPLY_RUN_ACTION = (parsed.runAction || "run") as "run";
export const DICTATION_SUGGEST_MAX_TOKENS = parsed.maxCompletionTokens;
export const DICTATION_SUGGEST_TIMEOUT_SECS = parsed.timeoutSecs;

const vocabSet = new Set<string>(DICTATION_SUGGEST_VOCABULARY.map((w) => w.toLowerCase()));

const TRANSCRIPT_START = "<<<TRANSCRIPT>>>";
const TRANSCRIPT_END = "<<<END>>>";

export function buildDictationSuggestUserMessage(transcript: string): string {
  return [
    "Classify this dictation for a reply-strip action.",
    "",
    TRANSCRIPT_START,
    transcript.trim(),
    TRANSCRIPT_END,
  ].join("\n");
}

export function isDictationVocabWord(value: string): value is DictationVocabWord {
  return vocabSet.has(value.trim().toLowerCase());
}

export function isDictationReplyAction(value: unknown): value is DictationReplyAction {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === DICTATION_REPLY_RUN_ACTION) return true;
  return isDictationVocabWord(trimmed);
}

/** Normalize model/JSON output to run or one vocabulary word; fallback run. */
export function clampDictationReplyAction(raw: unknown): DictationReplyAction {
  const tryWord = (value: string): DictationReplyAction | null => {
    const trimmed = value.trim().replace(/\s+/g, " ");
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === DICTATION_REPLY_RUN_ACTION) return "run";
    const hit = DICTATION_SUGGEST_VOCABULARY.find(
      (w) => w.toLowerCase() === trimmed.toLowerCase(),
    );
    return hit ?? null;
  };

  if (typeof raw === "string") {
    const direct = tryWord(raw);
    if (direct) return direct;
    try {
      return clampDictationReplyAction(JSON.parse(raw));
    } catch {
      return "run";
    }
  }

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.action === "string") {
      return tryWord(obj.action) ?? "run";
    }
    if (Array.isArray(obj.prompts) && typeof obj.prompts[0] === "string") {
      return tryWord(obj.prompts[0]) ?? "run";
    }
  }

  return "run";
}

export function dictationReplyActionLabel(action: DictationReplyAction): string {
  return action === "run" ? "Run" : action;
}
