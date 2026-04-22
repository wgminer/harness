/** Fallback label when a conversation has no stored title (matches sidebar). */
export function formatNewChatLabel(createdAt: number): string {
  return "New chat @ " + new Date(createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function conversationDisplayTitle(title: string | null, createdAt: number): string {
  const t = title?.trim();
  return t ? t : formatNewChatLabel(createdAt);
}
