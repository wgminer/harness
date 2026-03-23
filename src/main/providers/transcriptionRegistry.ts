import type { Settings } from "../../shared/types";
import type { TranscriptionProvider } from "./types";
import { createOpenAITranscriptionProvider } from "./openaiTranscription";
import { createParakeetTranscriptionProvider } from "./parakeetTranscription";

export function getTranscriptionProvider(settings: Settings): TranscriptionProvider {
  switch (settings.transcription?.activeProvider) {
    case "local":
      return createParakeetTranscriptionProvider(settings);
    case "openai":
    default:
      return createOpenAITranscriptionProvider(settings.openai?.apiKey ?? "");
  }
}
