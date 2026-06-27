import { createOpenAIProvider } from "./openai";
import type { LLMProvider } from "./types";

export function getProvider(apiKey: string): LLMProvider {
  return createOpenAIProvider(apiKey);
}
