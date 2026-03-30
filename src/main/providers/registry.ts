import type { Settings } from "../../shared/types";
import type { LLMProvider } from "./types";
import { createOpenAIProvider } from "./openai";

export function getProvider(settings: Settings): LLMProvider {
  return createOpenAIProvider(settings.openai?.apiKey ?? "");
}
