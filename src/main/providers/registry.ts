import type { Settings } from "../../shared/types";
import type { LLMProvider } from "./types";
import { createOpenAIProvider } from "./openai";
import { createOllamaProvider } from "./ollama";

export function getProvider(settings: Settings): LLMProvider {
  switch (settings.activeProvider) {
    case "ollama":
      return createOllamaProvider(
        settings.ollama?.baseUrl ?? "http://localhost:11434",
        settings.ollama?.model ?? "llama3"
      );
    case "openai":
    default:
      return createOpenAIProvider(
        settings.openai?.apiKey ?? "",
        settings.openai?.model ?? "gpt-5.2"
      );
  }
}
