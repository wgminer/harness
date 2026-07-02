import { createAppleSpeechTranscriptionProvider } from "./appleSpeechTranscription";
import type { TranscriptionProvider } from "./types";

export function getTranscriptionProvider(): TranscriptionProvider {
  return createAppleSpeechTranscriptionProvider();
}
