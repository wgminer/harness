import { createParakeetTranscriptionProvider } from "./parakeetTranscription";
import type { TranscriptionProvider } from "./types";

export function getTranscriptionProvider(): TranscriptionProvider {
  return createParakeetTranscriptionProvider();
}
