import type { ToolCallDisplay } from "./chatHelpers";
import { getInlineWriteup } from "./chatHelpers";

export type AssistantSyncFields = {
  content: string;
  toolCalls?: ToolCallDisplay[];
  model?: string;
};

/**
 * Merge stored assistant fields into the live bubble after stream end.
 * Never replace non-empty streamed content with a longer previous turn —
 * storage has no message ids, so "last assistant" can be stale until append
 * lands (and length-based overwrite made that race visible after tool calls).
 */
export function mergeAssistantFromStorage(
  local: AssistantSyncFields,
  stored: AssistantSyncFields
): AssistantSyncFields | null {
  const storedContent = stored.content.trim();
  if (!storedContent && !(stored.toolCalls?.length)) return null;

  const localWriteup = getInlineWriteup(local.toolCalls);
  const storedWriteup = getInlineWriteup(stored.toolCalls);
  const storedHasNote = !!storedWriteup?.noteId;

  const toolCallsNeedSync =
    !!stored.toolCalls &&
    (stored.toolCalls.length !== (local.toolCalls?.length ?? 0) ||
      storedHasNote !== !!localWriteup?.noteId);

  // Only fill content when the live bubble never received chunks.
  const contentNeedsSync = !local.content.trim() && !!storedContent;
  const modelNeedsSync = !!stored.model && stored.model !== local.model;

  if (!contentNeedsSync && !toolCallsNeedSync && !modelNeedsSync) return null;

  return {
    content: contentNeedsSync ? stored.content : local.content,
    toolCalls: toolCallsNeedSync ? stored.toolCalls : local.toolCalls,
    model: modelNeedsSync ? stored.model : local.model,
  };
}

/** Track stream-ends from aborted turns so they don't patch the next turn. */
export function noteStaleStreamEndExpected(pending: number): number {
  return pending + 1;
}

export function consumeStaleStreamEnd(pending: number): {
  pending: number;
  ignore: boolean;
} {
  if (pending <= 0) return { pending: 0, ignore: false };
  return { pending: pending - 1, ignore: true };
}
