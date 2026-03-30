/** Cumulative usage recorded by this app (stored locally; not synced with OpenAI billing). */
export interface UsageStatsSnapshot {
  openai: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  parakeet: {
    /** Sum of subword tokens reported by the Parakeet CLI when parseable. */
    modelTokens: number;
    /** Sum of whitespace-separated words in successful transcripts. */
    words: number;
    /** Number of completed transcriptions (after Parakeet succeeded). */
    transcriptions: number;
  };
  /** Last time a counter was updated (ms since epoch). */
  updatedAt: number;
}

export const EMPTY_USAGE_STATS: UsageStatsSnapshot = {
  openai: {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  },
  parakeet: {
    modelTokens: 0,
    words: 0,
    transcriptions: 0,
  },
  updatedAt: 0,
};
