import { useState, useEffect, useRef, useCallback } from "react";
import { Layers, Minimize2 } from "lucide-react";
import { OPENAI_CHAT_MODEL } from "../shared/openaiModels";
import { DICTATION_POLISH_INSTRUCTION } from "../shared/dictationPolish";
import { HOME_HEADER_QUOTE } from "../shared/headerQuote";
import { ChatTitleModal } from "./ChatTitleModal";
import { ContextInspectorModal } from "./ContextInspectorModal";
import { ChatSurface } from "./ChatSurface";
import { ChatComposer } from "./ChatComposer";
import { useChatComposer } from "./useChatComposer";
import {
  type Message,
  type ToolCallDisplay,
  formatMessageNoteTitle,
  getInlineWriteup,
  type LiveNoteStream,
} from "./chatHelpers";
import { shouldFocusComposerAfterTurn } from "./composerFocusPolicy";
import { shouldApplyTurnUpdate } from "./chatTurnFlow";
import { scheduleAfterStreamEndSync } from "./streamEndScheduling";
import { stripSentAtPrefix } from "../shared/chatTemporalContext";
import { chatRequiresApiKeyMessage } from "../shared/setupState";

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
  /** Parent increments when the composer should be focused (e.g. switching to small window). */
  focusComposerNonce?: number;
  onWindowSizeToggle: () => void;
  onOpenNotesView?: (noteId: string) => void;
  /** When false, chat/polish/reply are blocked with a setup message. */
  openAIConfigured?: boolean;
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
  onWindowSizeToggle,
  onOpenNotesView,
  openAIConfigured = true,
}: ChatViewProps) {
  /** Set synchronously on first send so thread UI mounts before parent re-renders. */
  const [draftConversationId, setDraftConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const effectiveConversationId = conversationId ?? draftConversationId;
  const isComposeMode = effectiveConversationId === null && messages.length === 0;
  const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<string | null>(null);
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
  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [contextModalOpen, setContextModalOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);

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

  const sending = isTurnPending || isStreaming;

  useEffect(() => {
    conversationIdRef.current = effectiveConversationId;
  }, [effectiveConversationId]);

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
    const list = await window.harness.memory.getMessages(convId);
    const lastAssistant = [...list].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant?.content?.trim()) return;
    const storedToolCalls = (lastAssistant as Message).toolCalls;
    const storedWriteup = getInlineWriteup(storedToolCalls);
    const storedHasNote = !!storedWriteup?.noteId;
    setMessages((prev) => {
      let patched = false;
      const next = prev.map((m) => {
        if (m.id !== assistantId) return m;
        const localWriteup = getInlineWriteup(m.toolCalls);
        const contentNeedsSync = m.content.length < lastAssistant.content.length;
        const toolCallsNeedSync =
          !!storedToolCalls &&
          (storedToolCalls.length !== (m.toolCalls?.length ?? 0) ||
            storedHasNote !== !!localWriteup?.noteId);
        if (!contentNeedsSync && !toolCallsNeedSync) return m;
        patched = true;
        return {
          ...m,
          content: contentNeedsSync ? lastAssistant.content : m.content,
          toolCalls: toolCallsNeedSync ? storedToolCalls : m.toolCalls,
          model: (lastAssistant as Message).model ?? m.model,
        };
      });
      if (patched) return next;
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && !last.content.trim()) {
        return [
          ...prev.slice(0, -1),
          {
            ...last,
            content: lastAssistant.content,
            toolCalls: (lastAssistant as Message).toolCalls ?? last.toolCalls,
            model: (lastAssistant as Message).model ?? last.model,
          },
        ];
      }
      return prev;
    });
  }, []);

  const beginNewTurn = useCallback(() => {
    const priorAbort = streamAbortRef.current;
    if (priorAbort && !priorAbort.signal.aborted) {
      priorAbort.abort();
    }
    if (sendingRef.current) {
      void window.harness.chat.stop().catch(() => {});
    }
    const nextTurnId = turnIdRef.current + 1;
    turnIdRef.current = nextTurnId;
    activeTurnIdRef.current = nextTurnId;
    streamAbortRef.current = new AbortController();
    setIsTurnPending(true);
    setIsStreaming(false);
    setLiveNoteStream(null);
    return { turnId: nextTurnId, signal: streamAbortRef.current.signal };
  }, []);

  const applyAssistantChunk = useCallback((assistantId: string, updater: (prev: string) => string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              content: updater(message.content),
            }
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
        applyAssistantChunk(assistantId, () => errorText);
        completeTurn(turnId);
      }
    },
    [applyAssistantChunk, completeTurn, isTurnCurrent, onConversationCreated]
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
        activeAssistantMessageIdRef.current = null;
        isStreamingRef.current = false;
        setActiveAssistantMessageId(null);
        setIsTurnPending(false);
        setIsStreaming(false);
        setCopiedId(null);
        setSavedToNotesId(null);
        setPolishHintAfterDictation(false);
        setTitleModalOpen(false);
        setLiveNoteStream(null);
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
    activeAssistantMessageIdRef.current = null;
    isStreamingRef.current = false;
    setActiveAssistantMessageId(null);
    setIsTurnPending(false);
    setIsStreaming(false);
    setCopiedId(null);
    setSavedToNotesId(null);
    setPolishHintAfterDictation(false);
    setTitleModalOpen(false);
    setLiveNoteStream(null);
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
          applyAssistantChunk(assistantId, () => p.summary!.trim());
          setAssistantToolCall(assistantId, toolName, payload);
        } else {
          setAssistantToolCall(assistantId, toolName, payload);
        }
        return;
      }

      if (toolName === "open_long_response") return;
      setAssistantToolCall(assistantId, toolName, payload);
    });
    return () => {
      unsub();
    };
  }, [activeAssistantMessageId, applyAssistantChunk, isTurnCurrent, setAssistantToolCall]);

  useEffect(() => {
    const unsubChunk = window.harness.chat.onStreamChunk((cid, chunk) => {
      if (cid !== conversationIdRef.current) return;
      if (!isStreamingRef.current) return;
      const assistantId = activeAssistantMessageIdRef.current;
      const turnId = activeTurnIdRef.current;
      const signal = streamAbortRef.current?.signal;
      if (!assistantId || turnId == null || !isTurnCurrent(turnId, signal)) return;
      applyAssistantChunk(assistantId, (prev) => stripSentAtPrefix(prev + chunk));
    });
    const unsubEnd = window.harness.chat.onStreamEnd((cid) => {
      if (cid !== conversationIdRef.current) return;
      const turnId = activeTurnIdRef.current;
      if (turnId == null) return;
      const assistantId = activeAssistantMessageIdRef.current;
      const documentHasFocus = document.hasFocus();
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
  }, [applyAssistantChunk, completeTurn, isTurnCurrent, syncAssistantFromStorage]);

  useEffect(() => {
    const unsubOpen = window.harness.chat.onNoteStreamOpen((cid, noteId, title, summary) => {
      if (cid !== conversationIdRef.current) return;
      const assistantId = activeAssistantMessageIdRef.current;
      if (!assistantId) return;
      setLiveNoteStream({ noteId, title, summary, body: "" });
      applyAssistantChunk(assistantId, () => summary);
      setAssistantToolCall(assistantId, "note_create", {
        note: { id: noteId, title },
        summary,
        attachedToMessage: true,
      });
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
    });
    return () => {
      unsubOpen();
      unsubChunk();
      unsubClose();
    };
  }, [applyAssistantChunk, setAssistantToolCall]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      activeTurnIdRef.current = null;
      void window.harness.chat.stop().catch(() => {});
    };
  }, []);

  const streamingContent = activeAssistantMessageId
    ? messages.find((m) => m.id === activeAssistantMessageId)?.content ?? ""
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
        convId = await window.harness.memory.createConversation();
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
    [blockLlmAction, effectiveConversationId, onAssignConversationId, openAIConfigured, sendText]
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
    setTitleModalOpen(true);
  }, [displayTitle]);

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

  const composerProps = {
    input: composer.input,
    onInputChange: composer.setInput,
    onSend: () => void composer.send(),
    onStop: () => {
      const turnId = activeTurnIdRef.current;
      streamAbortRef.current?.abort();
      void window.harness.chat.stop().catch(() => {});
      if (turnId != null) completeTurn(turnId);
    },
    sending: sending || composer.composerBusy,
    voiceState: composer.voiceState,
    voiceError: composer.voiceError,
    recordingMs: composer.recordingMs,
    onStartRecording: () => void composer.startRecording(),
    onStopRecording: () => void composer.stopAndTranscribe(),
    onCancelRecording: () => void composer.cancelRecording(),
    attachedAudioName: composer.attachedAudioFile?.name ?? null,
    attachmentTranscribing: composer.attachmentTranscribing,
    attachmentError: composer.attachmentError,
    onAttachAudio: (file: File | null) => {
      composer.setAttachedAudioFile(file);
      composer.setAttachmentError(null);
    },
    onRemoveAttachedAudio: () => {
      composer.setAttachedAudioFile(null);
      composer.setAttachmentError(null);
    },
    focusComposerNonce,
    inputRef: composer.inputRef,
  };

  const cornerControls = (
    <div className="chat-pane-corner-control">
      <button
        type="button"
        className="btn btn-icon chat-pane-corner-btn"
        onClick={() => setContextModalOpen(true)}
        aria-label="View context"
        title="View context"
      >
        <Layers size={14} />
      </button>
      <button
        type="button"
        className="btn btn-icon chat-pane-corner-btn"
        onClick={onWindowSizeToggle}
        aria-label="Shrink window"
        title="Shrink window"
      >
        <Minimize2 size={14} />
      </button>
    </div>
  );

  if (isComposeMode) {
    return (
      <>
        <div className="new-chat-pane">
          {cornerControls}
        <div className="new-chat-center">
          <p className="new-chat-quote">{HOME_HEADER_QUOTE}</p>
          <div
            ref={composerRef}
            className="new-chat-composer"
            data-testid="chat-composer"
            role="group"
            aria-label="Message composer"
          >
            <ChatComposer {...composerProps} />
          </div>
        </div>
        </div>
        <ContextInspectorModal
          open={contextModalOpen}
          onClose={() => setContextModalOpen(false)}
          conversationId={effectiveConversationId}
        />
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
            title="Edit title"
            aria-busy={titlePending ? true : undefined}
          >
            {titlePending ? (
              <span className="chat-pane-title-skeleton" aria-label="Generating title" />
            ) : (
              displayTitle
            )}
          </button>
        )}
        headerCornerControl={cornerControls}
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
        onGenerateReply={generateReply}
        onOptionSelect={handleOptionSelect}
        liveNoteStream={liveNoteStream}
        onOpenNoteInEditor={onOpenNotesView}
        {...composerProps}
        messagesTestId="chat-messages"
        composerTestId="chat-composer"
      />
      <ChatTitleModal
        open={titleModalOpen}
        onClose={() => setTitleModalOpen(false)}
        titleDraft={titleDraft}
        onTitleDraftChange={setTitleDraft}
        onSave={() => void saveConversationTitle()}
        saving={titleSaving}
      />
      <ContextInspectorModal
        open={contextModalOpen}
        onClose={() => setContextModalOpen(false)}
        conversationId={effectiveConversationId}
      />
    </>
  );
}
