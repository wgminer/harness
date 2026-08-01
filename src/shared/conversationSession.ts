/** Initial sidebar label for voice-dictation threads; LLM may replace when configured. */
export function formatVoiceDictationTitle(date: Date = new Date()): string {
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `Dictation @ ${time}`;
}

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
  /** True once the conversation has at least one persisted message. */
  hasMessages?: boolean;
  /** Desktop cognitive mode; omitted means chat. */
  chatMode?: "chat" | "decide" | "write" | "refine";
};

/** Sidebar visibility — message-less threads are hidden. */
export function isSidebarVisibleConversation(row: ConversationListRow): boolean {
  return row.hasMessages === true;
}

/** Settled fallback when a conversation has no stored title (display-only; not written mid-flight). */
export function formatEmptyChatLabel(createdAt: number): string {
  return (
    "Empty chat @ " +
    new Date(createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
  );
}

/** True while a real title is still expected — show a skeleton instead of any time-placeholder. */
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
  if (createdAt != null) return formatEmptyChatLabel(createdAt);
  return formatEmptyChatLabel(Date.now());
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
