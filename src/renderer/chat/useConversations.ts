import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isSidebarVisibleConversation } from "../../shared/conversationSession";
import type { Conversation } from "../sidebar/sidebarUtils";
import type { useConversationTitles } from "./useConversationTitles";

type ConversationTitles = ReturnType<typeof useConversationTitles>;

/** Keep `preferredId` when it is still visible; otherwise fall back to the newest visible row. */
export function resolveConversationId(
  list: Conversation[],
  preferredId: string | null,
): string | null {
  if (list.length === 0) return null;
  if (preferredId) {
    const preferred = list.find((c) => c.id === preferredId);
    if (preferred && isSidebarVisibleConversation(preferred)) return preferredId;
  }
  return list.find(isSidebarVisibleConversation)?.id ?? null;
}

/** Conversation list + active conversation selection for the chat surface and sidebar. */
export function useConversations(titles: ConversationTitles) {
  const { markTitleAwaiting, settleResolvedTitles, forgetConversationTitle } = titles;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);

  /** Replace the list (after sync/import/title events) without resetting the view. */
  const applyConversationList = useCallback((list: Conversation[]) => {
    setConversations(list);
    setConversationId((current) => resolveConversationId(list, current));
    settleResolvedTitles(list);
  }, [settleResolvedTitles]);

  const refreshConversations = useCallback(async () => {
    applyConversationList(await window.harness.memory.listConversations());
  }, [applyConversationList]);

  useEffect(() => {
    const unsubTitle = window.harness.chat.onConversationTitleUpdated(() => {
      void refreshConversations();
    });
    const unsubAction = window.harness.chat.onDictationReplyActionUpdated(() => {
      void refreshConversations();
    });
    return () => {
      unsubTitle();
      unsubAction();
    };
  }, [refreshConversations]);

  /** Chat created a conversation on first send — select it and add an optimistic row. */
  const assignConversationId = useCallback((id: string) => {
    setConversationId(id);
    markTitleAwaiting(id);
    setConversations((prev) => {
      if (prev.some((c) => c.id === id)) {
        return prev.map((c) => (c.id === id ? { ...c, hasMessages: true } : c));
      }
      return [
        { id, title: null, createdAt: Date.now(), sessionKind: "chat", hasMessages: true },
        ...prev,
      ];
    });
  }, [markTitleAwaiting]);

  const deleteConversation = useCallback(async (id: string) => {
    await window.harness.memory.deleteConversation(id);
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    forgetConversationTitle(id);
    if (conversationId === id) {
      setConversationId(remaining.find(isSidebarVisibleConversation)?.id ?? null);
    }
  }, [conversationId, conversations, forgetConversationTitle]);

  const sidebarConversations = useMemo(
    () => conversations.filter(isSidebarVisibleConversation),
    [conversations],
  );

  const activeChatConversation = useMemo(
    () => (conversationId ? conversations.find((c) => c.id === conversationId) ?? null : null),
    [conversations, conversationId],
  );

  return {
    conversations,
    setConversations,
    conversationsRef,
    conversationId,
    setConversationId,
    conversationIdRef,
    sidebarConversations,
    activeChatConversation,
    applyConversationList,
    refreshConversations,
    assignConversationId,
    deleteConversation,
  };
}
