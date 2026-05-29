import { utcMonthKey, utcMonthLabel, type ModelTokenUsage } from "./openaiPricing";

/** Per-model token totals for one UTC calendar month. */
export type OpenAIMonthModelUsage = ModelTokenUsage;

/** Aggregated OpenAI usage for the current UTC month (computed on read). */
export interface OpenAIThisMonthSnapshot {
  monthKey: string;
  monthLabel: string;
  estimatedUsd: number;
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
}

/** Cumulative usage recorded by this app (stored locally; not synced with OpenAI billing). */
export interface UsageStatsSnapshot {
  openai: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  /** Harness OpenAI usage for the current UTC calendar month with estimated cost. */
  openaiThisMonth: OpenAIThisMonthSnapshot;
  parakeet: {
    /** Sum of subword tokens reported by the Parakeet CLI when parseable. */
    modelTokens: number;
    /** Sum of whitespace-separated words in successful transcripts. */
    words: number;
    /** Successful non-empty transcriptions (one per completed Parakeet run with text). */
    transcriptions: number;
  };
  /** Last time a counter was updated (ms since epoch). */
  updatedAt: number;
}

const _emptyMonthKey = utcMonthKey();

export const EMPTY_OPENAI_THIS_MONTH: OpenAIThisMonthSnapshot = {
  monthKey: _emptyMonthKey,
  monthLabel: utcMonthLabel(_emptyMonthKey),
  estimatedUsd: 0,
  promptTokens: 0,
  cachedPromptTokens: 0,
  completionTokens: 0,
};

export const EMPTY_USAGE_STATS: UsageStatsSnapshot = {
  openai: {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  },
  openaiThisMonth: { ...EMPTY_OPENAI_THIS_MONTH },
  parakeet: {
    modelTokens: 0,
    words: 0,
    transcriptions: 0,
  },
  updatedAt: 0,
};

/** Persisted shape (v2) — monthly buckets keyed by YYYY-MM UTC. */
export interface UsageStatsPersisted {
  version: 2;
  openaiByMonth: Record<string, Record<string, OpenAIMonthModelUsage>>;
  parakeet: UsageStatsSnapshot["parakeet"];
  updatedAt: number;
}
