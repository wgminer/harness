import { useCallback, useEffect, useRef, useState } from "react";
import { isTimePlaceholderTitle } from "../../shared/conversationSession";
import { withoutKey } from "../../shared/withoutKey";
import type { Conversation } from "../sidebar/sidebarUtils";

/**
 * Tracks async LLM thread-title generation so the sidebar and titlebar can show a pending state.
 */
export function useConversationTitles() {
  /** Per-conversation refcount for async LLM thread title generation after a reply. */
  const [titleGenInFlight, setTitleGenInFlight] = useState<Record<string, number>>({});
  /** Optimistic pending until Rust start/end settles — avoids Empty/Dictation flash before `started`. */
  const [titleAwaitingIds, setTitleAwaitingIds] = useState<Record<string, true>>({});
  const harnessE2eRef = useRef(false);

  useEffect(() => {
    void window.harness.env.isHarnessE2E().then((v) => {
      harnessE2eRef.current = v;
    });
  }, []);

  const markTitleAwaiting = useCallback((id: string) => {
    if (harnessE2eRef.current) return;
    setTitleAwaitingIds((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  const bumpTitleGen = useCallback((id: string, delta: 1 | -1) => {
    setTitleGenInFlight((prev) => {
      const n = (prev[id] ?? 0) + delta;
      const next = { ...prev };
      if (n <= 0) delete next[id];
      else next[id] = n;
      if (delta === -1 && n <= 0) {
        setTitleAwaitingIds((awaiting) => withoutKey(awaiting, id));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    const unsubStart = window.harness.chat.onTitleGenerationStarted((id) => bumpTitleGen(id, 1));
    const unsubEnd = window.harness.chat.onTitleGenerationEnded((id) => bumpTitleGen(id, -1));
    return () => {
      unsubStart();
      unsubEnd();
    };
  }, [bumpTitleGen]);

  /** Drop optimistic pending marks for rows whose title has since been written. */
  const settleResolvedTitles = useCallback((list: Conversation[]) => {
    setTitleAwaitingIds((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(prev)) {
        const row = list.find((c) => c.id === id);
        if (row && !isTimePlaceholderTitle(row.title)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const forgetConversationTitle = useCallback((id: string) => {
    setTitleAwaitingIds((prev) => withoutKey(prev, id));
    setTitleGenInFlight((prev) => withoutKey(prev, id));
  }, []);

  const isTitleGenerating = useCallback(
    (id: string) => (titleGenInFlight[id] ?? 0) > 0 || !!titleAwaitingIds[id],
    [titleGenInFlight, titleAwaitingIds],
  );

  return {
    titleGenInFlight,
    titleAwaitingIds,
    markTitleAwaiting,
    settleResolvedTitles,
    forgetConversationTitle,
    isTitleGenerating,
  };
}
