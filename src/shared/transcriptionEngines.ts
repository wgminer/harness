/**
 * Desktop on-device transcription engines from resources/contracts/transcriptionEngines.json.
 */

import contract from "../../resources/contracts/transcriptionEngines.json";

export type TranscriptionEngineId = "apple" | "parakeet";

export interface TranscriptionEngineDefinition {
  id: TranscriptionEngineId;
  label: string;
  description: string;
}

interface TranscriptionEnginesContract {
  default: TranscriptionEngineId;
  engines: TranscriptionEngineDefinition[];
}

const parsed = contract as TranscriptionEnginesContract;

export const TRANSCRIPTION_ENGINES: TranscriptionEngineDefinition[] = parsed.engines;

export const DEFAULT_TRANSCRIPTION_ENGINE: TranscriptionEngineId = parsed.default;

export function normalizeTranscriptionEngine(raw: unknown): TranscriptionEngineId {
  return TRANSCRIPTION_ENGINES.some((e) => e.id === raw)
    ? (raw as TranscriptionEngineId)
    : DEFAULT_TRANSCRIPTION_ENGINE;
}

/** Model readiness reported by `recording:transcriptionEngineStatus`. */
export interface TranscriptionEngineStatus {
  state: "ready" | "missing" | "downloading" | "failed";
  error?: string;
}
