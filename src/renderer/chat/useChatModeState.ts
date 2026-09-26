import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CHAT_MODE, getChatMode, nextChatMode, type ChatModeId } from "../../shared/chatModes";
import type { CodingScopeMeta } from "../../shared/desktopAPI";

/** Chat / Q&A mode and coding scope for the open conversation (or compose home before first send). */
export function useChatModeState({
  conversationId,
  draftConversationId,
  effectiveConversationId,
  isComposeMode,
  conversationChatMode,
  onConversationCreated,
}: {
  conversationId: string | null;
  draftConversationId: string | null;
  effectiveConversationId: string | null;
  isComposeMode: boolean;
  conversationChatMode: string | null | undefined;
  onConversationCreated: () => void;
}) {
  /** Pending mode on compose home; resets to Chat when opening a fresh home. */
  const [composeChatMode, setComposeChatMode] = useState<ChatModeId>(DEFAULT_CHAT_MODE);
  /** Optimistic mode while persist catches up — avoids UI flicker. */
  const [optimisticChatMode, setOptimisticChatMode] = useState<ChatModeId | null>(null);
  const [modeSwitching, setModeSwitching] = useState(false);
  const [codingScope, setCodingScope] = useState<CodingScopeMeta | null>(null);
  const [selfScopeAvailable, setSelfScopeAvailable] = useState(false);

  useEffect(() => {
    if (conversationId === null && draftConversationId === null) {
      setComposeChatMode(DEFAULT_CHAT_MODE);
      setOptimisticChatMode(null);
      setCodingScope(null);
    }
  }, [conversationId, draftConversationId]);

  useEffect(() => {
    void window.harness.coding
      .selfScopeAvailable()
      .then(setSelfScopeAvailable)
      .catch(() => setSelfScopeAvailable(false));
  }, []);

  useEffect(() => {
    if (!effectiveConversationId) {
      // Compose home keeps local codingScope until first send.
      return;
    }
    let cancelled = false;
    void window.harness.coding
      .getScope(effectiveConversationId)
      .then((scope) => {
        if (!cancelled) setCodingScope(scope);
      })
      .catch(() => {
        if (!cancelled) setCodingScope(null);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveConversationId]);

  const applyCodingScope = useCallback(
    async (next: CodingScopeMeta | null) => {
      setCodingScope(next);
      if (!effectiveConversationId) return;
      await window.harness.coding.setScope(effectiveConversationId, next);
    },
    [effectiveConversationId],
  );

  useEffect(() => {
    if (
      optimisticChatMode != null &&
      !isComposeMode &&
      getChatMode(conversationChatMode).id === optimisticChatMode
    ) {
      setOptimisticChatMode(null);
    }
  }, [conversationChatMode, isComposeMode, optimisticChatMode]);

  const activeChatMode: ChatModeId =
    optimisticChatMode ??
    (isComposeMode ? composeChatMode : getChatMode(conversationChatMode).id);

  const handleChatModeChange = useCallback(
    async (next: ChatModeId) => {
      if (next === activeChatMode || modeSwitching) return;
      setOptimisticChatMode(next);

      if (isComposeMode || !effectiveConversationId) {
        setComposeChatMode(next);
        return;
      }

      setModeSwitching(true);
      try {
        await window.harness.memory.setConversationChatMode(effectiveConversationId, next);
        onConversationCreated();
      } catch {
        setOptimisticChatMode(null);
      } finally {
        setModeSwitching(false);
      }
    },
    [
      activeChatMode,
      effectiveConversationId,
      isComposeMode,
      modeSwitching,
      onConversationCreated,
    ],
  );

  const handleCycleMode = useCallback(() => {
    void handleChatModeChange(nextChatMode(activeChatMode));
  }, [activeChatMode, handleChatModeChange]);

  const resetOptimisticChatMode = useCallback(() => {
    setOptimisticChatMode(null);
  }, []);

  return {
    composeChatMode,
    activeChatMode,
    modeSwitching,
    resetOptimisticChatMode,
    handleChatModeChange,
    handleCycleMode,
    codingScope,
    selfScopeAvailable,
    applyCodingScope,
  };
}
