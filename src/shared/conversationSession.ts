/** Legacy auto titles that should be replaced by LLM summaries. */
export function isTimePlaceholderTitle(title: string | null | undefined): boolean {
  const t = title?.trim();
  if (!t) return true;
  return /^(?:Dictation|New chat|Empty chat) @ /i.test(t);
}

export type ConversationSessionKind = "dictation" | "chat";

export type ConversationListRow = {
  id: string;
  title: string | null;
  createdAt: number;
  sessionKind?: ConversationSessionKind;
  hasAssistantReply?: boolean;
};

/** Fallback when a conversation has no stored title (matches historical sidebar labels). */
export function formatNewChatLabel(createdAt: number): string {
  return (
    "Empty chat @ " +
    new Date(createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

/** Stored title suitable for LLM refinement (null when empty or legacy time placeholder). */
export function effectiveConversationTitle(title: string | null | undefined): string | null {
  const t = title?.trim();
  if (!t || isTimePlaceholderTitle(t)) return null;
  return t;
}

/** True while the title LLM runs — show a skeleton instead of placeholder text. */
export function isConversationTitlePending(
  title: string | null | undefined,
  titleGenerating: boolean
): boolean {
  return titleGenerating && isTimePlaceholderTitle(title);
}

/** Sidebar/header label: show stored titles (including legacy `@ time`), else time-based empty-chat label. */
export function conversationDisplayTitle(
  title: string | null | undefined,
  createdAt?: number
): string {
  const t = title?.trim();
  if (t) return t;
  if (createdAt != null) return formatNewChatLabel(createdAt);
  return formatNewChatLabel(Date.now());
}

/** Sidebar icon: mic for dictation-only, message bubble once it is or becomes a chat. */
export function conversationSidebarIconKind(
  row: Pick<ConversationListRow, "title" | "sessionKind" | "hasAssistantReply">
): "dictation" | "chat" {
  const dictation =
    row.sessionKind === "dictation" ||
    (row.sessionKind == null && !!row.title && /^Dictation @ /i.test(row.title));
  if (dictation && !row.hasAssistantReply) return "dictation";
  return "chat";
}
