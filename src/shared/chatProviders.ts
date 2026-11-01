/**
 * Desktop text-model providers from resources/contracts/chatProviders.json.
 */

import contract from "../../resources/contracts/chatProviders.json";

export type ChatProviderId = "openai" | "claude" | "local";

export interface ChatProviderDefinition {
  id: ChatProviderId;
  label: string;
  description: string;
  chatModel: string;
  smallModel: string;
  /** Local only: the OpenAI-compatible endpoint Ollama serves. */
  defaultBaseUrl?: string;
}

interface ChatProvidersContract {
  default: ChatProviderId;
  providers: ChatProviderDefinition[];
}

const parsed = contract as ChatProvidersContract;

export const CHAT_PROVIDERS: ChatProviderDefinition[] = parsed.providers;

export const DEFAULT_CHAT_PROVIDER: ChatProviderId = parsed.default;

const LOCAL = CHAT_PROVIDERS.find((p) => p.id === "local");

export const DEFAULT_LOCAL_BASE_URL = LOCAL?.defaultBaseUrl ?? "";

export const DEFAULT_LOCAL_MODEL = LOCAL?.chatModel ?? "";

export function normalizeChatProvider(raw: unknown): ChatProviderId {
  return CHAT_PROVIDERS.some((p) => p.id === raw) ? (raw as ChatProviderId) : DEFAULT_CHAT_PROVIDER;
}
