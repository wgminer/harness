import type { Settings } from "../../shared/types";
import type { TranscriptionProvider } from "./types";
import { createOpenAITranscriptionProvider } from "./openaiTranscription";
import { createLocalTranscriptionProvider } from "./localTranscription";

export function getTranscriptionProvider(settings: Settings): TranscriptionProvider {
  switch (settings.transcription?.activeProvider) {
    case "local":
      return createLocalTranscriptionProvider(
        settings.transcription.baseUrl ?? "http://localhost:8080",
        settings.transcription.model ?? "whisper-1"
      );
    case "openai":
    default:
      return createOpenAITranscriptionProvider(settings.openai?.apiKey ?? "");
  }
}
