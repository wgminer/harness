/**
 * Desktop chat modes — labels/placeholders/overlays from resources/contracts/chatModes.json.
 */

import contract from "../../resources/contracts/chatModes.json";

export type ChatModeId = "chat" | "decide" | "write" | "refine";

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

export function isChatModeId(value: unknown): value is ChatModeId {
  return value === "chat" || value === "decide" || value === "write" || value === "refine";
}

export function getChatMode(id: ChatModeId | string | null | undefined): ChatModeDefinition {
  if (id && byId.has(id as ChatModeId)) {
    return byId.get(id as ChatModeId)!;
  }
  return byId.get(DEFAULT_CHAT_MODE)!;
}

export function chatModeOverlay(id: ChatModeId | string | null | undefined): string | null {
  return getChatMode(id).systemOverlay;
}

export function chatModePlaceholder(id: ChatModeId | string | null | undefined): string {
  return getChatMode(id).placeholder;
}

/** Cycle Chat → Decide → Write → Refine → Chat. */
export function nextChatMode(current: ChatModeId | string | null | undefined): ChatModeId {
  const id = getChatMode(current).id;
  const index = CHAT_MODES.findIndex((m) => m.id === id);
  const next = CHAT_MODES[(index + 1) % CHAT_MODES.length];
  return next?.id ?? DEFAULT_CHAT_MODE;
}
