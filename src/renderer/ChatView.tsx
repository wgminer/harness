import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { OPENAI_CHAT_MODEL } from "../shared/openaiModels";
import { DICTATION_POLISH_INSTRUCTION } from "../shared/dictationPolish";
import {
  formatHomeHeaderQuoteTooltip,
  nextHomeHeaderQuote,
  type HomeHeaderQuote,
} from "../shared/headerQuote";
import {
  chatModePlaceholder,
  DEFAULT_CHAT_MODE,
  getChatMode,
  nextChatMode,
  type ChatModeId,
} from "../shared/chatModes";
import { ChatTitleModal } from "./ChatTitleModal";
import { ChatSurface } from "./ChatSurface";
import { ChatComposer } from "./ChatComposer";
import { ChatModePicker } from "./ChatModePicker";
import { DictationSuggestedPromptChips } from "./DictationSuggestedPromptChips";
import { Skeleton } from "./Skeleton";
import { useChatComposer } from "./useChatComposer";
import {
  type Message,
  type ToolCallDisplay,
  formatMessageNoteTitle,
  type LiveNoteStream,
} from "./chatHelpers";
import { shouldFocusComposerAfterTurn } from "./composerFocusPolicy";
import { shouldApplyTurnUpdate } from "./chatTurnFlow";
import {
  mergeAssistantFromStorage,
  noteStaleStreamEndExpected,
  consumeStaleStreamEnd,
  type AssistantSyncFields,
} from "./assistantStorageSync";
import { scheduleAfterStreamEndSync } from "./streamEndScheduling";
import { stripSentAtPrefix } from "../shared/chatTemporalContext";
import { chatRequiresApiKeyMessage } from "../shared/setupState";
import {
  clampDictationReplyAction,
  dictationReplyActionLabel,
  type DictationReplyAction,
} from "../shared/dictationSuggestedPrompts";
import type { ConversationSessionKind } from "../shared/conversationSession";
import type { RecordingLink } from "../shared/types";
import { formatDictateDurationLabel } from "../shared/dictateDurationLabel";

/** Mounts only on empty compose — draws once per visit from the shuffle bag. */
function ComposeHeaderQuote() {
  const [quote] = useState<HomeHeaderQuote>(() => nextHomeHeaderQuote());
  return (
    <span className="tooltip new-chat-quote-tooltip">
      <p className="new-chat-quote">“{quote.full}”</p>
      <span className="tooltip__label">{formatHomeHeaderQuoteTooltip(quote)}</span>
    </span>
  );
}

function formatComposeClock(now: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);
}

function formatComposeDate(now: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now);
}

/** Quiet ambient facts in the four corners of the compose splash. */
function ComposeCornerMeta() {
  const [now, setNow] = useState(() => new Date());
  const [durationLabel, setDurationLabel] = useState(() => formatDictateDurationLabel(0));
  const [weatherLabel, setWeatherLabel] = useState("—");

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshMeta = async () => {
      try {
        const stats = await window.harness.recording.archiveStats();
        if (!cancelled) {
          setDurationLabel(formatDictateDurationLabel(stats?.durationMs ?? 0));
        }
      } catch {
        // Keep last known label if IPC is unavailable.
      }
      try {
        const weather = await window.harness.weather.getCurrent();
        if (!cancelled) {
          setWeatherLabel(
            typeof weather?.label === "string" && weather.label.trim().length > 0
              ? weather.label
              : "—",
          );
        }
      } catch {
        if (!cancelled) setWeatherLabel("—");
      }
    };

    void refreshMeta();
    const onFocus = () => {
      void refreshMeta();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return (
    <>
      <p className="new-chat-corner new-chat-corner--top-left" aria-hidden="true">
        {formatComposeClock(now)}
      </p>
      <p className="new-chat-corner new-chat-corner--top-right" aria-hidden="true">
        {formatComposeDate(now)}
      </p>
      <p className="new-chat-corner new-chat-corner--bottom-left" aria-hidden="true">
        {durationLabel}
      </p>
      <p className="new-chat-corner new-chat-corner--bottom-right" aria-hidden="true">
        {weatherLabel}
      </p>
    </>
  );
}

interface ChatViewProps {
  conversationId: string | null;
  /** Shown in header; matches sidebar label for this conversation. */
  displayTitle: string;
  /** When true, header shows a skeleton instead of placeholder title text. */
  titlePending?: boolean;
  onConversationCreated: () => void;
  /** Called when the first message creates a new conversation (compose splash). */
  onAssignConversationId: (id: string) => void;
  /** Text from the global hotkey — send vs pre-fill follows recording.autoSend unless draft-only. */
  pendingHotkeyText?: string | null;
  /** If true, always pre-fill input (never auto-send), e.g. recording stopped while the app was unfocused. */
  pendingHotkeyDraftOnly?: boolean;
  onPendingHotkeyTextConsumed?: () => void;
  /** Fires when this chat is waiting on / streaming from the model (not composer voice). */
  onChatActivityChange?: (active: boolean) => void;
  /** Parent increments when the composer should be focused. */
  focusComposerNonce?: number;
  onOpenNotesView?: (noteId: string) => void;
  /** Refresh the notes library after agent tools create/update/delete notes. */
  onNotesChanged?: () => void;
  /** When false, chat/polish/reply are blocked with a setup message. */
  openAIConfigured?: boolean;
  /** Mirror focused Fn recording into the composer mic chrome. */
  mirrorGlobalFnRecording?: boolean;
  /** Persisted mode for the open conversation (from list meta). */
  conversationChatMode?: string | null;
  /** Cached dictation strip action from conversation meta (`run` or vocab word). */
  conversationDictationReplyAction?: string | null;
  /** When the conversation was created (ms); used in the details modal. */
  conversationCreatedAt?: number | null;
  /** Dictation vs chat session kind from list meta. */
  conversationSessionKind?: ConversationSessionKind | null;
  /** True once an assistant reply exists (dictation → chat transition). */
  conversationHasAssistantReply?: boolean;
}

export function ChatView({
  conversationId,
  displayTitle,
  titlePending = false,
  onConversationCreated,
  onAssignConversationId,
  pendingHotkeyText,
  pendingHotkeyDraftOnly,
  onPendingHotkeyTextConsumed,
  onChatActivityChange,
  focusComposerNonce,
  onOpenNotesView,
  onNotesChanged,
  openAIConfigured = true,
  mirrorGlobalFnRecording = false,
  conversationChatMode = null,
  conversationDictationReplyAction = null,
  conversationCreatedAt = null,
  conversationSessionKind = null,
  conversationHasAssistantReply = false,
}: ChatViewProps) {
  /** Set synchronously on first send so thread UI mounts before parent re-renders. */
  const [draftConversationId, setDraftConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const effectiveConversationId = conversationId ?? draftConversationId;
  const isComposeMode = effectiveConversationId === null && messages.length === 0;
  /** Pending mode on compose home; resets to Chat when opening a fresh home. */
  const [composeChatMode, setComposeChatMode] = useState<ChatModeId>(DEFAULT_CHAT_MODE);
  /** Optimistic mode while persist catches up — avoids UI flicker. */
  const [optimisticChatMode, setOptimisticChatMode] = useState<ChatModeId | null>(null);
  const [modeSwitching, setModeSwitching] = useState(false);
  const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const streamingTextRef = useRef("");
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const [isTurnPending, setIsTurnPending] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [savedToNotesId, setSavedToNotesId] = useState<string | null>(null);
  const [activeChatModel, setActiveChatModel] = useState("");
  const activeChatModelRef = useRef("");
  const conversationIdRef = useRef<string | null>(conversationId);
  const sendingRef = useRef(false);
  const isStreamingRef = useRef(false);

  /** After plain dictation, show polish next to reply (polish targets the dictated turn only). */
  const [polishHintAfterDictation, setPolishHintAfterDictation] = useState(false);
  const [dictationReplyAction, setDictationReplyAction] = useState<DictationReplyAction | null>(
    null,
  );
  const [dictationReplyActionLoading, setDictationReplyActionLoading] = useState(false);
  const dictationReplyEnsureForRef = useRef<string | null>(null);
  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [titleModalRecordings, setTitleModalRecordings] = useState<RecordingLink[]>([]);
  const [titleModalRecordingsLoading, setTitleModalRecordingsLoading] = useState(false);

  const [liveNoteStream, setLiveNoteStream] = useState<LiveNoteStream | null>(null);

  /** Tool calls for the assistant turn currently being streamed; shown inline and then stored on the message when stream ends. */
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const prevConversationIdRef = useRef<string | null | undefined>(undefined);
  const resetComposerInputRef = useRef<() => void>(() => {});
  const firstSendInProgressRef = useRef(false);
  const messagesRef = useRef<Message[]>([]);
  const nextMessageIdRef = useRef(0);
  const turnIdRef = useRef(0);
  const activeTurnIdRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const pendingStaleStreamEndsRef = useRef(0);

  const sending = isTurnPending || isStreaming;

  useEffect(() => {
    conversationIdRef.current = effectiveConversationId;
  }, [effectiveConversationId]);

  useEffect(() => {
    if (conversationId === null && draftConversationId === null) {
      setComposeChatMode(DEFAULT_CHAT_MODE);
      setOptimisticChatMode(null);
    }
  }, [conversationId, draftConversationId]);

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

  useEffect(() => {
    if (conversationId) setDraftConversationId(null);
  }, [conversationId]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);
  useEffect(() => {
    activeAssistantMessageIdRef.current = activeAssistantMessageId;
  }, [activeAssistantMessageId]);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  useEffect(() => {
    activeChatModelRef.current = activeChatModel;
  }, [activeChatModel]);

  const makeMessageId = useCallback((prefix: "user" | "assistant" | "history") => {
    const id = `${prefix}-${Date.now()}-${nextMessageIdRef.current}`;
    nextMessageIdRef.current += 1;
    return id;
  }, []);

  const isTurnCurrent = useCallback((turnId: number, signal?: AbortSignal) => {
    return shouldApplyTurnUpdate({
      activeTurnId: activeTurnIdRef.current,
      expectedTurnId: turnId,
      aborted: !!signal?.aborted,
    });
  }, []);

  const focusComposer = useCallback(() => {
    requestAnimationFrame(() =>
      composerRef.current?.querySelector<HTMLTextAreaElement>(".chat-input")?.focus()
    );
  }, []);

  const completeTurn = useCallback((turnId: number, documentHasFocus = document.hasFocus()) => {
    if (activeTurnIdRef.current !== turnId) return;
    activeTurnIdRef.current = null;
    streamAbortRef.current = null;
    isStreamingRef.current = false;
    activeAssistantMessageIdRef.current = null;
    firstSendInProgressRef.current = false;
    setIsTurnPending(false);
    setIsStreaming(false);
    setActiveAssistantMessageId(null);
    if (shouldFocusComposerAfterTurn(documentHasFocus)) {
      focusComposer();
    }
  }, [focusComposer]);

  const syncAssistantFromStorage = useCallback(async (convId: string, assistantId: string | null) => {
    if (!assistantId) return;
    const list = await window.harness.memory.getMessages(convId);
    const lastAssistant = [...list].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const stored: AssistantSyncFields = {
      content: lastAssistant.content ?? "",
      toolCalls: (lastAssistant as Message).toolCalls,
      model: (lastAssistant as Message).model,
    };
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m;
        const merged = mergeAssistantFromStorage(m, stored);
        return merged ? { ...m, ...merged } : m;
      })
    );
  }, []);

  const beginNewTurn = useCallback(() => {
    const priorAbort = streamAbortRef.current;
    const supersedingInFlight = sendingRef.current || isStreamingRef.current;
    if (priorAbort && !priorAbort.signal.aborted) {
      priorAbort.abort();
    }
    if (sendingRef.current) {
      void window.harness.chat.stop().catch(() => {});
    }
    if (supersedingInFlight) {
      pendingStaleStreamEndsRef.current = noteStaleStreamEndExpected(
        pendingStaleStreamEndsRef.current
      );
    }
    const nextTurnId = turnIdRef.current + 1;
    turnIdRef.current = nextTurnId;
    activeTurnIdRef.current = nextTurnId;
    streamAbortRef.current = new AbortController();
    streamingTextRef.current = "";
    setStreamingText("");
    setIsTurnPending(true);
    setIsStreaming(false);
    setLiveNoteStream(null);
    return { turnId: nextTurnId, signal: streamAbortRef.current.signal };
  }, []);

  /**
   * In-flight assistant text lives outside `messages` so a streamed chunk does
   * not clone the whole transcript (and re-render every settled row). It is
   * committed into the message once, at stream end.
   */
  const appendStreamingText = useCallback((chunk: string) => {
    const next = stripSentAtPrefix(streamingTextRef.current + chunk);
    streamingTextRef.current = next;
    setStreamingText(next);
  }, []);

  /** Replaces assistant content outright (error text, note summary). */
  const setAssistantContent = useCallback((assistantId: string, content: string) => {
    streamingTextRef.current = "";
    setStreamingText("");
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId ? { ...message, content } : message
      )
    );
  }, []);

  /**
   * Fold the streamed buffer into the message before storage sync runs, so a
   * failed sync can never blank out a reply the user already watched arrive.
   */
  const commitStreamingText = useCallback((assistantId: string | null) => {
    const text = streamingTextRef.current;
    streamingTextRef.current = "";
    setStreamingText("");
    if (!assistantId || !text) return;
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId && message.content !== text
          ? { ...message, content: text }
          : message
      )
    );
  }, []);

  const setAssistantToolCall = useCallback((assistantId: string, toolName: string, payload: unknown) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== assistantId) return message;
        const existing = message.toolCalls ?? [];
        if (toolName === "note_create" || toolName === "open_long_response") {
          const idx = existing.findIndex((tc) => tc.toolName === toolName);
          const entry = { toolName, payload };
          const toolCalls =
            idx >= 0 ? existing.map((tc, i) => (i === idx ? entry : tc)) : [...existing, entry];
          return { ...message, toolCalls };
        }
        return { ...message, toolCalls: [...existing, { toolName, payload }] };
      })
    );
  }, []);

  const appendAssistantPlaceholder = useCallback((assistantMessageId: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        toolCalls: [],
        model: activeChatModelRef.current,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  const runAssistantTurn = useCallback(
    async (args: {
      turnId: number;
      signal: AbortSignal;
      assistantId: string;
      backend: () => Promise<unknown>;
    }) => {
      const { turnId, signal, assistantId, backend } = args;
      try {
        await backend();
        onConversationCreated();
      } catch (e) {
        const wasAborted = signal.aborted || String(e).toLowerCase().includes("abort");
        if (wasAborted) {
          completeTurn(turnId);
          return;
        }
        if (!isTurnCurrent(turnId, signal)) return;
        const errorText = `[Error: ${e instanceof Error ? e.message : String(e)}]`;
        setAssistantContent(assistantId, errorText);
        completeTurn(turnId);
      }
    },
    [setAssistantContent, completeTurn, isTurnCurrent, onConversationCreated]
  );

  useEffect(() => {
    setActiveChatModel(OPENAI_CHAT_MODEL);
  }, [effectiveConversationId]);

  /** Sidebar spinner: model reply only (not composer voice record/transcribe). */
  const chatActivityBusy = sending;
  useEffect(() => {
    onChatActivityChange?.(chatActivityBusy);
  }, [chatActivityBusy, onChatActivityChange]);

  useEffect(() => {
    return () => onChatActivityChange?.(false);
  }, [onChatActivityChange]);

  useEffect(() => {
    const prev = prevConversationIdRef.current;
    prevConversationIdRef.current = effectiveConversationId;

    if (!effectiveConversationId) {
      if (prev != null) {
        streamAbortRef.current?.abort();
        streamAbortRef.current = null;
        activeTurnIdRef.current = null;
        void window.harness.chat.stop().catch(() => {});
        setMessages([]);
        streamingTextRef.current = "";
        setStreamingText("");
        activeAssistantMessageIdRef.current = null;
        isStreamingRef.current = false;
        setActiveAssistantMessageId(null);
        setIsTurnPending(false);
        setIsStreaming(false);
        setCopiedId(null);
        setSavedToNotesId(null);
        setPolishHintAfterDictation(false);
        setDictationReplyAction(null);
        setDictationReplyActionLoading(false);
        dictationReplyEnsureForRef.current = null;
        setTitleModalOpen(false);
        setLiveNoteStream(null);
        setOptimisticChatMode(null);
        resetComposerInputRef.current();
        focusComposer();
      }
      return;
    }

    if (prev === null && (activeTurnIdRef.current != null || firstSendInProgressRef.current)) {
      return;
    }

    resetComposerInputRef.current();
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    activeTurnIdRef.current = null;
    void window.harness.chat.stop().catch(() => {});
    setMessages([]);
    streamingTextRef.current = "";
    setStreamingText("");
    activeAssistantMessageIdRef.current = null;
    isStreamingRef.current = false;
    setActiveAssistantMessageId(null);
    setIsTurnPending(false);
    setIsStreaming(false);
    setCopiedId(null);
    setSavedToNotesId(null);
    setPolishHintAfterDictation(false);
    setDictationReplyAction(
      conversationDictationReplyAction
        ? clampDictationReplyAction(conversationDictationReplyAction)
        : null,
    );
    setDictationReplyActionLoading(false);
    dictationReplyEnsureForRef.current = null;
    setTitleModalOpen(false);
    setLiveNoteStream(null);
    setOptimisticChatMode(null);
    focusComposer();

    let cancelled = false;
    window.harness.memory.getMessages(effectiveConversationId).then((list) => {
      if (cancelled) return;
      setMessages(
        list.map((m, i) => ({
          id: `history-${(m as Message).timestamp ?? Date.now()}-${i}`,
          role: m.role,
          content: m.content,
          toolCalls: (m as Message).toolCalls,
          timestamp: (m as Message).timestamp,
          model: (m as Message).model,
        }))
      );
    });
    return () => {
      cancelled = true;
    };
  }, [effectiveConversationId, focusComposer]);

  useEffect(() => {
    const unsub = window.harness.chat.onToolPanelUpdate((cid, toolName, payload) => {
      if (cid !== conversationIdRef.current) return;
      const assistantId = activeAssistantMessageId;
      const turnId = activeTurnIdRef.current;
      const signal = streamAbortRef.current?.signal;
      if (!assistantId || turnId == null || !isTurnCurrent(turnId, signal)) return;

      if (toolName === "note_create") {
        const p = payload as {
          attachedToMessage?: boolean;
          summary?: string;
        };
        if (p?.attachedToMessage && typeof p.summary === "string" && p.summary.trim()) {
          setAssistantContent(assistantId, p.summary.trim());
          setAssistantToolCall(assistantId, toolName, payload);
        } else {
          setAssistantToolCall(assistantId, toolName, payload);
        }
        onNotesChanged?.();
        return;
      }

      if (toolName === "note_delete" || toolName === "note_save") {
        setAssistantToolCall(assistantId, toolName, payload);
        onNotesChanged?.();
        return;
      }

      if (toolName === "open_long_response") return;
      setAssistantToolCall(assistantId, toolName, payload);
    });
    return () => {
      unsub();
    };
  }, [activeAssistantMessageId, setAssistantContent, isTurnCurrent, onNotesChanged, setAssistantToolCall]);

  useEffect(() => {
    const unsubChunk = window.harness.chat.onStreamChunk((cid, chunk) => {
      if (cid !== conversationIdRef.current) return;
      if (!isStreamingRef.current) return;
      const assistantId = activeAssistantMessageIdRef.current;
      const turnId = activeTurnIdRef.current;
      const signal = streamAbortRef.current?.signal;
      if (!assistantId || turnId == null || !isTurnCurrent(turnId, signal)) return;
      appendStreamingText(chunk);
    });
    const unsubEnd = window.harness.chat.onStreamEnd((cid) => {
      if (cid !== conversationIdRef.current) return;
      const stale = consumeStaleStreamEnd(pendingStaleStreamEndsRef.current);
      pendingStaleStreamEndsRef.current = stale.pending;
      if (stale.ignore) return;
      const turnId = activeTurnIdRef.current;
      if (turnId == null) return;
      const assistantId = activeAssistantMessageIdRef.current;
      const documentHasFocus = document.hasFocus();
      commitStreamingText(assistantId);
      void syncAssistantFromStorage(cid, assistantId).finally(() => {
        scheduleAfterStreamEndSync(() => {
          if (activeTurnIdRef.current === turnId) {
            completeTurn(turnId, documentHasFocus);
          }
        });
      });
    });
    return () => {
      unsubChunk();
      unsubEnd();
    };
  }, [appendStreamingText, commitStreamingText, completeTurn, isTurnCurrent, syncAssistantFromStorage]);

  useEffect(() => {
    const unsubOpen = window.harness.chat.onNoteStreamOpen((cid, noteId, title, summary) => {
      if (cid !== conversationIdRef.current) return;
      const assistantId = activeAssistantMessageIdRef.current;
      if (!assistantId) return;
      setLiveNoteStream({ noteId, title, summary, body: "" });
      setAssistantContent(assistantId, summary);
      setAssistantToolCall(assistantId, "note_create", {
        note: { id: noteId, title },
        summary,
        attachedToMessage: true,
      });
      onNotesChanged?.();
    });
    const unsubChunk = window.harness.chat.onNoteStreamChunk((cid, noteId, chunk) => {
      if (cid !== conversationIdRef.current) return;
      setLiveNoteStream((prev) =>
        prev && prev.noteId === noteId ? { ...prev, body: prev.body + chunk } : prev,
      );
    });
    const unsubClose = window.harness.chat.onNoteStreamClose((cid, noteId) => {
      if (cid !== conversationIdRef.current) return;
      const assistantId = activeAssistantMessageIdRef.current;
      setLiveNoteStream((prev) => {
        if (!prev || prev.noteId !== noteId) return prev;
        if (assistantId) {
          setAssistantToolCall(assistantId, "note_create", {
            note: { id: prev.noteId, title: prev.title },
            summary: prev.summary,
            attachedToMessage: true,
          });
        }
        return null;
      });
      // Body/word count may have changed after the stream landed.
      onNotesChanged?.();
    });
    return () => {
      unsubOpen();
      unsubChunk();
      unsubClose();
    };
  }, [setAssistantContent, onNotesChanged, setAssistantToolCall]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      activeTurnIdRef.current = null;
      void window.harness.chat.stop().catch(() => {});
    };
  }, []);

  const streamingContent = activeAssistantMessageId
    ? streamingText ||
      messages.find((m) => m.id === activeAssistantMessageId)?.content ||
      ""
    : "";

  const handleToolConfirm = useCallback(
    async (tc: ToolCallDisplay, action: "proceed" | "cancel") => {
      const payload = tc.payload as {
        pending?: boolean;
        tool?: string;
        args?: Record<string, unknown>;
        pendingId?: string;
      } | undefined;
      if (!payload || payload.pending !== true) return;

      const pendingId = payload.pendingId;
      if (pendingId) {
        try {
          await window.harness.chat.resolveGatedTool(pendingId, action);
        } catch {
          // ignore; stream may have been stopped
        }
      }

      setMessages((prev) =>
        prev.map((m) => {
          if (!m.toolCalls || m.toolCalls.length === 0) return m;
          let changed = false;
          const updated = m.toolCalls.map((call) => {
            if (call !== tc) return call;
            const base =
              call.payload && typeof call.payload === "object" ? { ...(call.payload as Record<string, unknown>) } : {};
            base.pending = false;
            if (action === "cancel") base.cancelled = true;
            changed = true;
            return { ...call, payload: base };
          });
          return changed ? { ...m, toolCalls: updated } : m;
        })
      );
    },
    []
  );

  const setVoiceErrorRef = useRef<(message: string | null) => void>(() => {});

  const blockLlmAction = useCallback((): false => {
    setVoiceErrorRef.current(chatRequiresApiKeyMessage());
    return false;
  }, []);

  /** Core send logic; accepts text directly so it can be called programmatically (e.g. hotkey injection). */
  const sendText = useCallback(
    async (text: string, opts?: { fromDictation?: boolean }, targetConversationId?: string) => {
      const convId = targetConversationId ?? effectiveConversationId;
      if (!text.trim() || !convId) return;
      if (!openAIConfigured) {
        blockLlmAction();
        return;
      }
      if (opts?.fromDictation) setPolishHintAfterDictation(true);
      else setPolishHintAfterDictation(false);

      conversationIdRef.current = convId;

      const { turnId, signal } = beginNewTurn();
      const userMessageId = makeMessageId("user");
      const assistantMessageId = makeMessageId("assistant");
      activeAssistantMessageIdRef.current = null;
      setActiveAssistantMessageId(null);
      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: "user", content: text, timestamp: Date.now() },
      ]);
      if (!isTurnCurrent(turnId, signal)) return;

      activeAssistantMessageIdRef.current = assistantMessageId;
      setActiveAssistantMessageId(assistantMessageId);
      appendAssistantPlaceholder(assistantMessageId);
      if (!isTurnCurrent(turnId, signal)) return;

      setIsTurnPending(false);
      isStreamingRef.current = true;
      setIsStreaming(true);
      focusComposer();
      await runAssistantTurn({
        turnId,
        signal,
        assistantId: assistantMessageId,
        backend: () => window.harness.chat.send(convId, text),
      });
    },
    [
      appendAssistantPlaceholder,
      beginNewTurn,
      blockLlmAction,
      effectiveConversationId,
      focusComposer,
      isTurnCurrent,
      makeMessageId,
      openAIConfigured,
      runAssistantTurn,
    ]
  );

  const ensureConversationAndSend = useCallback(
    async (
      text: string,
      opts?: { fromDictation?: boolean; recordingPath?: string },
    ): Promise<boolean> => {
      if (!openAIConfigured) {
        return blockLlmAction();
      }
      let convId = effectiveConversationId;
      if (!convId) {
        convId = await window.harness.memory.createConversation(composeChatMode);
        firstSendInProgressRef.current = true;
        setDraftConversationId(convId);
        conversationIdRef.current = convId;
        onAssignConversationId(convId);
      }
      await sendText(text, opts, convId);
      if (opts?.recordingPath) {
        void window.harness.memory
          .linkDictationRecording(convId, opts.recordingPath)
          .catch(() => {});
      }
      return true;
    },
    [
      blockLlmAction,
      composeChatMode,
      effectiveConversationId,
      onAssignConversationId,
      openAIConfigured,
      sendText,
    ]
  );

  /** Post-strip polish: replace last user dictation with instruction + same text, then stream. */
  const polishLastUserFromStrip = useCallback(async () => {
    if (!effectiveConversationId) return;
    if (!openAIConfigured) {
      blockLlmAction();
      return;
    }
    const last = messagesRef.current[messagesRef.current.length - 1];
    if (!last || last.role !== "user" || !last.content?.trim()) return;
    setPolishHintAfterDictation(false);
    const instruction = DICTATION_POLISH_INSTRUCTION;
    const t1 = Date.now();
    const t2 = t1 + 1;
    const transcript = last.content;
    const { turnId, signal } = beginNewTurn();
    const instructionId = makeMessageId("user");
    const transcriptId = makeMessageId("user");
    const assistantMessageId = makeMessageId("assistant");
    activeAssistantMessageIdRef.current = null;
    setActiveAssistantMessageId(null);
    setMessages((prev) => [
      ...prev.slice(0, -1),
      { id: instructionId, role: "user", content: instruction, timestamp: t1 },
      { id: transcriptId, role: "user", content: transcript, timestamp: t2 },
    ]);
    if (!isTurnCurrent(turnId, signal)) return;
    activeAssistantMessageIdRef.current = assistantMessageId;
    setActiveAssistantMessageId(assistantMessageId);
    appendAssistantPlaceholder(assistantMessageId);
    if (!isTurnCurrent(turnId, signal)) return;
    setIsTurnPending(false);
    isStreamingRef.current = true;
    setIsStreaming(true);
    await runAssistantTurn({
      turnId,
      signal,
      assistantId: assistantMessageId,
      backend: () => window.harness.chat.polishLastUser(effectiveConversationId),
    });
  }, [
    appendAssistantPlaceholder,
    beginNewTurn,
    blockLlmAction,
    effectiveConversationId,
    isTurnCurrent,
    makeMessageId,
    openAIConfigured,
    runAssistantTurn,
  ]);

  const composer = useChatComposer({
    onSubmit: ensureConversationAndSend,
    pendingHotkeyText,
    pendingHotkeyDraftOnly,
    onPendingHotkeyTextConsumed,
    focusComposerNonce,
    composerRef,
    submitDisabled: sending,
    allowHotkeyWithoutConversation: true,
    hasConversation: effectiveConversationId != null,
    mirrorGlobalFnRecording,
  });

  resetComposerInputRef.current = composer.resetComposerInput;
  setVoiceErrorRef.current = composer.setVoiceError;

  const generateReply = useCallback(async () => {
    if (!effectiveConversationId) return;
    if (!openAIConfigured) {
      blockLlmAction();
      return;
    }
    const { turnId, signal } = beginNewTurn();
    const assistantMessageId = makeMessageId("assistant");
    activeAssistantMessageIdRef.current = assistantMessageId;
    setActiveAssistantMessageId(assistantMessageId);
    appendAssistantPlaceholder(assistantMessageId);
    setIsTurnPending(false);
    isStreamingRef.current = true;
    setIsStreaming(true);
    await runAssistantTurn({
      turnId,
      signal,
      assistantId: assistantMessageId,
      backend: () => window.harness.chat.generateReply(effectiveConversationId),
    });
  }, [
    appendAssistantPlaceholder,
    beginNewTurn,
    blockLlmAction,
    effectiveConversationId,
    makeMessageId,
    openAIConfigured,
    runAssistantTurn,
  ]);

  const handleOptionSelect = useCallback(
    (label: string) => void ensureConversationAndSend(label),
    [ensureConversationAndSend],
  );

  const handleDictationStripSelect = useCallback(
    (prompt: string) => {
      const action = clampDictationReplyAction(prompt);
      if (action === "run") {
        void generateReply();
        return;
      }
      void ensureConversationAndSend(action);
    },
    [ensureConversationAndSend, generateReply],
  );

  const saveMessageToNotes = useCallback(
    async (messageId: string, content: string, messageTimestamp?: number) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      try {
        const title =
          messageTimestamp != null ? formatMessageNoteTitle(messageTimestamp) : undefined;
        const note = await window.harness.notes.create(title, trimmed);
        setSavedToNotesId(messageId);
        window.setTimeout(() => {
          setSavedToNotesId((current) => (current === messageId ? null : current));
        }, 2000);
        onOpenNotesView?.(note.id);
      } catch {
        // Ignore; user can retry.
      }
    },
    [onOpenNotesView]
  );

  const openTitleModal = useCallback(() => {
    setTitleDraft(displayTitle);
    setTitleModalRecordings([]);
    setTitleModalRecordingsLoading(true);
    setTitleModalOpen(true);
  }, [displayTitle]);

  useEffect(() => {
    if (!titleModalOpen || !effectiveConversationId) {
      if (!titleModalOpen) {
        setTitleModalRecordings([]);
        setTitleModalRecordingsLoading(false);
      }
      return;
    }

    let cancelled = false;
    void window.harness.memory
      .getConversationRecordings(effectiveConversationId)
      .then((result) => {
        if (cancelled) return;
        setTitleModalRecordings(result.recordings ?? []);
        setTitleModalRecordingsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTitleModalRecordings([]);
        setTitleModalRecordingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [titleModalOpen, effectiveConversationId]);

  const saveConversationTitle = useCallback(async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || !effectiveConversationId) return;
    setTitleSaving(true);
    try {
      await window.harness.memory.setConversationTitle(effectiveConversationId, trimmed);
      onConversationCreated();
      setTitleModalOpen(false);
    } finally {
      setTitleSaving(false);
    }
  }, [titleDraft, effectiveConversationId, onConversationCreated]);

  const showRecordingInFinder = useCallback((path: string) => {
    void window.harness.recording.showInFolder(path);
  }, []);

  const awaitingReply =
    !isComposeMode &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === "user" &&
    !activeAssistantMessageId;

  /** Single user turn (dictation): suggested prompts in the reply strip. */
  const isDictationReplyStrip = awaitingReply && messages.length === 1;

  const handleModeChange = useCallback(
    (mode: ChatModeId) => void handleChatModeChange(mode),
    [handleChatModeChange],
  );

  const modePicker = useMemo(
    () => (
      <ChatModePicker
        value={activeChatMode}
        onChange={handleModeChange}
        disabled={sending || modeSwitching}
      />
    ),
    [activeChatMode, handleModeChange, sending, modeSwitching],
  );

  useEffect(() => {
    if (conversationDictationReplyAction) {
      setDictationReplyAction(clampDictationReplyAction(conversationDictationReplyAction));
    }
  }, [conversationDictationReplyAction, effectiveConversationId]);

  useEffect(() => {
    if (!isDictationReplyStrip || !effectiveConversationId) {
      dictationReplyEnsureForRef.current = null;
      if (!isDictationReplyStrip) {
        setDictationReplyActionLoading(false);
      }
      return;
    }

    const unsub = window.harness.chat.onDictationReplyActionUpdated((cid, action) => {
      if (cid !== effectiveConversationId) return;
      setDictationReplyAction(clampDictationReplyAction(action));
      setDictationReplyActionLoading(false);
    });

    if (dictationReplyAction != null) {
      setDictationReplyActionLoading(false);
      return () => unsub();
    }

    if (dictationReplyEnsureForRef.current === effectiveConversationId) {
      return () => unsub();
    }
    dictationReplyEnsureForRef.current = effectiveConversationId;
    setDictationReplyActionLoading(true);
    void window.harness.chat
      .ensureDictationReplyAction(effectiveConversationId)
      .then((action) => {
        if (dictationReplyEnsureForRef.current !== effectiveConversationId) return;
        setDictationReplyAction(clampDictationReplyAction(action));
      })
      .catch(() => {
        if (dictationReplyEnsureForRef.current !== effectiveConversationId) return;
        setDictationReplyAction("run");
      })
      .finally(() => {
        if (dictationReplyEnsureForRef.current === effectiveConversationId) {
          setDictationReplyActionLoading(false);
        }
      });

    return () => unsub();
  }, [isDictationReplyStrip, effectiveConversationId, dictationReplyAction]);

  const replyModeControl = isDictationReplyStrip ? (
    <DictationSuggestedPromptChips
      prompts={
        dictationReplyAction != null ? [dictationReplyActionLabel(dictationReplyAction)] : []
      }
      loading={dictationReplyActionLoading || dictationReplyAction == null}
      onSelect={handleDictationStripSelect}
      disabled={sending || !openAIConfigured || dictationReplyActionLoading}
    />
  ) : null;

  const {
    input: composerInput,
    setInput: setComposerInput,
    inputRef: composerInputRef,
    send: composerSend,
    voiceState,
    voiceError,
    recordingMs,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
    attachedAudioFile,
    attachmentTranscribing,
    attachmentError,
    setAttachedAudioFile,
    setAttachmentError,
    composerBusy,
  } = composer;

  const handleSend = useCallback(() => void composerSend(), [composerSend]);

  const handleStopTurn = useCallback(() => {
    const turnId = activeTurnIdRef.current;
    streamAbortRef.current?.abort();
    void window.harness.chat.stop().catch(() => {});
    if (turnId != null) completeTurn(turnId);
  }, [completeTurn]);

  const handleStartRecording = useCallback(() => void startRecording(), [startRecording]);
  const handleStopRecording = useCallback(() => void stopAndTranscribe(), [stopAndTranscribe]);
  const handleCancelRecording = useCallback(() => void cancelRecording(), [cancelRecording]);

  const handleAttachAudio = useCallback(
    (file: File | null) => {
      setAttachedAudioFile(file);
      setAttachmentError(null);
    },
    [setAttachedAudioFile, setAttachmentError],
  );

  const handleRemoveAttachedAudio = useCallback(() => {
    setAttachedAudioFile(null);
    setAttachmentError(null);
  }, [setAttachedAudioFile, setAttachmentError]);

  const composerProps = useMemo(
    () => ({
      input: composerInput,
      onInputChange: setComposerInput,
      onSend: handleSend,
      onStop: handleStopTurn,
      sending: sending || composerBusy,
      voiceState,
      voiceError,
      recordingMs,
      onStartRecording: handleStartRecording,
      onStopRecording: handleStopRecording,
      onCancelRecording: handleCancelRecording,
      attachedAudioName: attachedAudioFile?.name ?? null,
      attachmentTranscribing,
      attachmentError,
      onAttachAudio: handleAttachAudio,
      onRemoveAttachedAudio: handleRemoveAttachedAudio,
      onAttachmentError: setAttachmentError,
      focusComposerNonce,
      inputRef: composerInputRef,
      placeholder: chatModePlaceholder(activeChatMode),
      modeControl: modePicker,
      onCycleMode: handleCycleMode,
    }),
    [
      composerInput,
      setComposerInput,
      handleSend,
      handleStopTurn,
      sending,
      composerBusy,
      voiceState,
      voiceError,
      recordingMs,
      handleStartRecording,
      handleStopRecording,
      handleCancelRecording,
      attachedAudioFile,
      attachmentTranscribing,
      attachmentError,
      handleAttachAudio,
      handleRemoveAttachedAudio,
      setAttachmentError,
      focusComposerNonce,
      composerInputRef,
      activeChatMode,
      modePicker,
      handleCycleMode,
    ],
  );

  if (isComposeMode) {
    return (
      <>
        <div className="new-chat-pane">
        <ComposeCornerMeta />
        <div className="new-chat-center">
          <div className="new-chat-center-stack">
            <div
              ref={composerRef}
              className="new-chat-composer"
              data-testid="chat-composer"
              role="group"
              aria-label="Message composer"
            >
              <ChatComposer {...composerProps} />
            </div>
            <ComposeHeaderQuote />
          </div>
        </div>
        </div>
      </>
    );
  }

  return (
    <>
      <ChatSurface
        chatAreaRef={chatAreaRef}
        composerRef={composerRef}
        headerContent={(
          <button
            type="button"
            className="btn chat-pane-title"
            onClick={openTitleModal}
            title="Details"
            aria-busy={titlePending ? true : undefined}
          >
            {titlePending ? (
              <Skeleton className="ui-skeleton--title" label="Generating title" />
            ) : (
              displayTitle
            )}
          </button>
        )}
        displayMessages={messages}
        copiedId={copiedId}
        savedToNotesId={savedToNotesId}
        onCopied={setCopiedId}
        onSaveToNotes={saveMessageToNotes}
        streamingContent={streamingContent}
        polishHintAfterDictation={polishHintAfterDictation}
        llmActionsEnabled={openAIConfigured}
        onToolConfirm={handleToolConfirm}
        onPolish={polishLastUserFromStrip}
        replyModeControl={replyModeControl}
        onOptionSelect={handleOptionSelect}
        liveNoteStream={liveNoteStream}
        onOpenNoteInEditor={onOpenNotesView}
        {...composerProps}
        messagesTestId="chat-messages"
        composerTestId="chat-composer"
        hideComposer={isDictationReplyStrip}
      />
      <ChatTitleModal
        open={titleModalOpen}
        onClose={() => setTitleModalOpen(false)}
        titleDraft={titleDraft}
        onTitleDraftChange={setTitleDraft}
        onSave={() => void saveConversationTitle()}
        saving={titleSaving}
        sessionKind={conversationSessionKind}
        hasAssistantReply={conversationHasAssistantReply}
        createdAt={conversationCreatedAt}
        chatMode={activeChatMode}
        messageCount={messages.length}
        recordings={titleModalRecordings}
        recordingsLoading={titleModalRecordingsLoading}
        onShowRecordingInFinder={showRecordingInFinder}
      />
    </>
  );
}
