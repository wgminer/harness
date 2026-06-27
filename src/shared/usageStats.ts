/** Cumulative local transcription usage recorded by this app. */
export interface UsageStatsSnapshot {
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

export const EMPTY_USAGE_STATS: UsageStatsSnapshot = {
  parakeet: {
    modelTokens: 0,
    words: 0,
    transcriptions: 0,
  },
  updatedAt: 0,
};

/** Persisted shape (v3) — parakeet counters only. */
export interface UsageStatsPersisted {
  version: 3;
  parakeet: UsageStatsSnapshot["parakeet"];
  updatedAt: number;
}
