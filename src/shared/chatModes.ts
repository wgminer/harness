/**
 * Desktop chat modes — labels/placeholders/overlays from resources/contracts/chatModes.json.
 */

import contract from "../../resources/contracts/chatModes.json";

export type ChatModeId = "chat" | "qa";

/** Legacy ids persisted before Chat/Q&A collapse — normalize to `qa`. */
const LEGACY_QA_MODE_IDS = new Set(["decide", "write", "refine", "qa"]);

export interface ChatModeDefinition {
  id: ChatModeId;
  label: string;
  placeholder: string;
  systemOverlay: string | null;
}

interface ChatModesContract {
  modes: ChatModeDefinition[];
}

const parsed = contract as ChatModesContract;

export const CHAT_MODES: ChatModeDefinition[] = parsed.modes;

export const DEFAULT_CHAT_MODE: ChatModeId = "chat";

const byId = new Map(CHAT_MODES.map((m) => [m.id, m]));

/** Map stored / incoming mode strings onto Chat | Q&A. */
export function normalizeChatMode(value: unknown): ChatModeId {
  if (typeof value !== "string") return DEFAULT_CHAT_MODE;
  const trimmed = value.trim();
  if (trimmed === "chat") return "chat";
  if (LEGACY_QA_MODE_IDS.has(trimmed)) return "qa";
  return DEFAULT_CHAT_MODE;
}

export function isChatModeId(value: unknown): value is ChatModeId {
  return value === "chat" || value === "qa";
}

export function getChatMode(id: ChatModeId | string | null | undefined): ChatModeDefinition {
  const normalized = normalizeChatMode(id);
  return byId.get(normalized) ?? byId.get(DEFAULT_CHAT_MODE)!;
}

export function chatModeOverlay(id: ChatModeId | string | null | undefined): string | null {
  return getChatMode(id).systemOverlay;
}

export function chatModePlaceholder(id: ChatModeId | string | null | undefined): string {
  return getChatMode(id).placeholder;
}

/** Toggle Chat ↔ Q&A. */
export function nextChatMode(current: ChatModeId | string | null | undefined): ChatModeId {
  const id = getChatMode(current).id;
  const index = CHAT_MODES.findIndex((m) => m.id === id);
  const next = CHAT_MODES[(index + 1) % CHAT_MODES.length];
  return next?.id ?? DEFAULT_CHAT_MODE;
}
