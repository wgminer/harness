import { useState } from "react";

export function shouldUseStreamingAssistantRenderer(
  isLatestAssistant: boolean,
  messageId: string,
  streamedMessageIds: ReadonlySet<string>,
): boolean {
  return isLatestAssistant && streamedMessageIds.has(messageId);
}

/** Pin an assistant id as soon as its turn starts so the stream renderer never remounts. */
export function rememberStreamedAssistantId(
  current: ReadonlySet<string>,
  sending: boolean,
  assistantMessageId: string | null,
): ReadonlySet<string> {
  if (!sending || !assistantMessageId || current.has(assistantMessageId)) {
    return current;
  }
  const next = new Set(current);
  next.add(assistantMessageId);
  return next;
}

export function useStreamedAssistantIds(
  sending: boolean,
  latestAssistantId: string | null,
): ReadonlySet<string> {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const next = rememberStreamedAssistantId(ids, sending, latestAssistantId);
  if (next !== ids) {
    setIds(next);
  }
  return next;
}
