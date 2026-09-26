import { useState } from "react";
import {
  chatModePlaceholder,
  initialPlaceholderCycle,
  placeholderCycleForMode,
  placeholderCycleOnConversationChange,
  type ChatModeId,
  type PlaceholderCycleState,
} from "../../shared/chatModes";

type Cycle = PlaceholderCycleState & { conversationId: string | null };

/** Composer placeholder that advances each time Chat ↔ Q&A changes. */
export function useCyclingModePlaceholder(
  mode: ChatModeId,
  conversationId: string | null,
): string {
  const [cycle, setCycle] = useState<Cycle>(() => ({
    ...initialPlaceholderCycle(mode),
    conversationId,
  }));

  let shown = cycle;
  if (shown.conversationId !== conversationId) {
    shown = {
      ...placeholderCycleOnConversationChange(shown, shown.conversationId, conversationId, mode),
      conversationId,
    };
  }
  if (shown.mode !== mode) {
    shown = { ...placeholderCycleForMode(shown, mode), conversationId };
  }
  if (shown !== cycle) setCycle(shown);

  return chatModePlaceholder(shown.mode, shown.index);
}
