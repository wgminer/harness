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
  placeholders: string[];
  systemOverlay: string | null;
}

interface ChatModesContract {
  modes: ChatModeDefinition[];
}

const parsed = contract as ChatModesContract;

export const CHAT_MODES: ChatModeDefinition[] = parsed.modes;

export const DEFAULT_CHAT_MODE: ChatModeId = "chat";

const byId = new Map(CHAT_MODES.map((m) => [m.id, m]));

/** Map stored / incoming mode strings onto Chat | Grill (`qa`). */
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

const FALLBACK_PLACEHOLDER = "Write a message…";

export function chatModePlaceholders(id: ChatModeId | string | null | undefined): readonly string[] {
  const list = getChatMode(id).placeholders.filter((line) => line.trim().length > 0);
  return list.length > 0 ? list : [FALLBACK_PLACEHOLDER];
}

/** Placeholder for a mode. `index` walks that mode's list and wraps. */
export function chatModePlaceholder(
  id: ChatModeId | string | null | undefined,
  index = 0,
): string {
  const list = chatModePlaceholders(id);
  const i = ((Math.trunc(index) % list.length) + list.length) % list.length;
  return list[i] ?? FALLBACK_PLACEHOLDER;
}

export interface PlaceholderCycleState {
  mode: ChatModeId;
  index: number;
  /** Next index to show the next time this mode is entered. */
  nextByMode: Record<ChatModeId, number>;
}

/** First visit to `mode` shows its first line and consumes that slot. */
export function initialPlaceholderCycle(mode: ChatModeId): PlaceholderCycleState {
  return {
    mode,
    index: 0,
    nextByMode: {
      chat: mode === "chat" ? 1 : 0,
      qa: mode === "qa" ? 1 : 0,
    },
  };
}

/**
 * Enter `mode`. Staying put keeps the current line.
 * Each return visit advances that mode's own series.
 */
export function placeholderCycleForMode(
  state: PlaceholderCycleState,
  mode: ChatModeId,
): PlaceholderCycleState {
  if (state.mode === mode) return state;
  const len = chatModePlaceholders(mode).length;
  const index = state.nextByMode[mode] % len;
  return {
    mode,
    index,
    nextByMode: { ...state.nextByMode, [mode]: index + 1 },
  };
}

/**
 * Opening another thread starts that mode's series over.
 * Compose keeps its place when the first send assigns an id.
 */
export function placeholderCycleOnConversationChange(
  state: PlaceholderCycleState,
  prevConversationId: string | null,
  nextConversationId: string | null,
  mode: ChatModeId,
): PlaceholderCycleState {
  if (prevConversationId === nextConversationId) return state;
  const composeCommitted = prevConversationId === null && state.mode === mode;
  if (composeCommitted) return state;
  return initialPlaceholderCycle(mode);
}

/** Toggle Chat ↔ Grill. */
export function nextChatMode(current: ChatModeId | string | null | undefined): ChatModeId {
  const id = getChatMode(current).id;
  const index = CHAT_MODES.findIndex((m) => m.id === id);
  const next = CHAT_MODES[(index + 1) % CHAT_MODES.length];
  return next?.id ?? DEFAULT_CHAT_MODE;
}
