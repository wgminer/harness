import { useState, useEffect, useRef, useCallback } from "react";
import { Minimize2 } from "lucide-react";
import { useRecorder } from "./useRecorder";
import { playCancelChime } from "./recordingUtils";
import { audioFileToWav } from "./audioFileToWav";
import { OPENAI_CHAT_MODEL } from "../shared/openaiModels";
import { DICTATION_POLISH_INSTRUCTION } from "../shared/dictationPolish";
import { ChatTitleModal } from "./ChatTitleModal";
import { ChatSurface } from "./ChatSurface";
import {
  type Message,
  type ToolCallDisplay,
  type VoiceState,
} from "./chatHelpers";
import { shouldApplyTurnUpdate } from "./chatTurnFlow";

interface ChatViewProps {
  conversationId: string | null;
  /** Shown in header; matches sidebar label for this conversation. */
  displayTitle: string;
  /** When true, header shows a skeleton instead of placeholder title text. */
  titlePending?: boolean;
  onConversationCreated: () => void;
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
}

export function ChatView({
  conversationId,
  displayTitle,
  titlePending = false,
  onConversationCreated,
  pendingHotkeyText,
  pendingHotkeyDraftOnly,
  onPendingHotkeyTextConsumed,
  onChatActivityChange,
  focusComposerNonce,
  onWindowSizeToggle,
  onOpenNotesView,
}: ChatViewProps) {
  const MAX_RECORDING_MS = 5 * 60 * 1000;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
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

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  /** After plain dictation, show polish next to reply (polish targets the dictated turn only). */
  const [polishHintAfterDictation, setPolishHintAfterDictation] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const [attachedAudioFile, setAttachedAudioFile] = useState<File | null>(null);
  const [attachmentTranscribing, setAttachmentTranscribing] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const recordingStartRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptionRequestIdRef = useRef<string | null>(null);
  const transcriptionCancelledRef = useRef(false);

  const recorder = useRecorder();

  /** Tool calls for the assistant turn currently being streamed; shown inline and then stored on the message when stream ends. */
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const nextMessageIdRef = useRef(0);
  const turnIdRef = useRef(0);
  const activeTurnIdRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const sending = isTurnPending || isStreaming;

  useEffect(() => {
    conversationIdRef.current = conversationId;
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

  const completeTurn = useCallback((turnId: number) => {
    if (activeTurnIdRef.current !== turnId) return;
    activeTurnIdRef.current = null;
    streamAbortRef.current = null;
    isStreamingRef.current = false;
    activeAssistantMessageIdRef.current = null;
    setIsTurnPending(false);
    setIsStreaming(false);
    setActiveAssistantMessageId(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const syncAssistantFromStorage = useCallback(async (convId: string, assistantId: string | null) => {
    const list = await window.electron.memory.getMessages(convId);
    const lastAssistant = [...list].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant?.content?.trim()) return;
    setMessages((prev) => {
      let patched = false;
      const next = prev.map((m) => {
        if (m.id !== assistantId) return m;
        if (m.content.length >= lastAssistant.content.length) return m;
        patched = true;
        return {
          ...m,
          content: lastAssistant.content,
          toolCalls: (lastAssistant as Message).toolCalls ?? m.toolCalls,
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
      void window.electron.chat.stop().catch(() => {});
    }
    const nextTurnId = turnIdRef.current + 1;
    turnIdRef.current = nextTurnId;
    activeTurnIdRef.current = nextTurnId;
    streamAbortRef.current = new AbortController();
    setIsTurnPending(true);
    setIsStreaming(false);
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
      prev.map((message) =>
        message.id === assistantId
          ? {
              ...message,
              toolCalls: [...(message.toolCalls ?? []), { toolName, payload }],
            }
          : message
      )
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
  }, [conversationId]);

  /** Sidebar spinner: model reply only (not composer voice record/transcribe). */
  const chatActivityBusy = sending;
  useEffect(() => {
    onChatActivityChange?.(chatActivityBusy);
  }, [chatActivityBusy, onChatActivityChange]);

  useEffect(() => {
    return () => onChatActivityChange?.(false);
  }, [onChatActivityChange]);

  useEffect(() => {
    if (!conversationId) {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      activeTurnIdRef.current = null;
      setMessages([]);
      return;
    }

    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    activeTurnIdRef.current = null;
    void window.electron.chat.stop().catch(() => {});
    setMessages([]);
    activeAssistantMessageIdRef.current = null;
    isStreamingRef.current = false;
    setActiveAssistantMessageId(null);
    setIsTurnPending(false);
    setIsStreaming(false);
    setInput("");
    setCopiedId(null);
    setSavedToNotesId(null);
    setVoiceError(null);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    transcriptionRequestIdRef.current = null;
    transcriptionCancelledRef.current = false;
    setVoiceState("idle");
    setAttachedAudioFile(null);
    setAttachmentTranscribing(false);
    setAttachmentError(null);
    setPolishHintAfterDictation(false);
    setTitleModalOpen(false);

    let cancelled = false;
    window.electron.memory.getMessages(conversationId).then((list) => {
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
  }, [conversationId]);

  useEffect(() => {
    const unsub = window.electron.chat.onToolPanelUpdate((cid, toolName, payload) => {
      if (cid !== conversationIdRef.current) return;
      const assistantId = activeAssistantMessageId;
      const turnId = activeTurnIdRef.current;
      const signal = streamAbortRef.current?.signal;
      if (!assistantId || turnId == null || !isTurnCurrent(turnId, signal)) return;
      setAssistantToolCall(assistantId, toolName, payload);
    });
    return () => {
      unsub();
    };
  }, [activeAssistantMessageId, isTurnCurrent, setAssistantToolCall]);

  useEffect(() => {
    const unsubChunk = window.electron.chat.onStreamChunk((cid, chunk) => {
      if (cid !== conversationIdRef.current) return;
      if (!isStreamingRef.current) return;
      const assistantId = activeAssistantMessageIdRef.current;
      const turnId = activeTurnIdRef.current;
      const signal = streamAbortRef.current?.signal;
      if (!assistantId || turnId == null || !isTurnCurrent(turnId, signal)) return;
      applyAssistantChunk(assistantId, (prev) => prev + chunk);
    });
    const unsubEnd = window.electron.chat.onStreamEnd((cid) => {
      if (cid !== conversationIdRef.current) return;
      const turnId = activeTurnIdRef.current;
      if (turnId == null) return;
      const assistantId = activeAssistantMessageIdRef.current;
      void syncAssistantFromStorage(cid, assistantId).finally(() => {
        if (activeTurnIdRef.current === turnId) {
          completeTurn(turnId);
        }
      });
    });
    return () => {
      unsubChunk();
      unsubEnd();
    };
  }, [applyAssistantChunk, completeTurn, isTurnCurrent, syncAssistantFromStorage]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      activeTurnIdRef.current = null;
      void window.electron.chat.stop().catch(() => {});
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
          await window.electron.chat.resolveGatedTool(pendingId, action);
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

  /** Core send logic; accepts text directly so it can be called programmatically (e.g. hotkey injection). */
  const sendText = useCallback(
    async (text: string, opts?: { fromDictation?: boolean }) => {
      if (!text.trim() || !conversationId) return;
      if (opts?.fromDictation) setPolishHintAfterDictation(true);
      else setPolishHintAfterDictation(false);

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
      requestAnimationFrame(() => inputRef.current?.focus());
      await runAssistantTurn({
        turnId,
        signal,
        assistantId: assistantMessageId,
        backend: () => window.electron.chat.send(conversationId, text),
      });
    },
    [
      appendAssistantPlaceholder,
      beginNewTurn,
      conversationId,
      isTurnCurrent,
      makeMessageId,
      runAssistantTurn,
    ]
  );

  /** Post-strip polish: replace last user dictation with instruction + same text, then stream. */
  const polishLastUserFromStrip = useCallback(async () => {
    if (!conversationId) return;
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
      backend: () => window.electron.chat.polishLastUser(conversationId),
    });
  }, [
    appendAssistantPlaceholder,
    beginNewTurn,
    conversationId,
    isTurnCurrent,
    makeMessageId,
    runAssistantTurn,
  ]);

  const send = useCallback(async () => {
    if (attachmentTranscribing) return;

    const text = input.trim();
    const attached = attachedAudioFile;
    if (!text && !attached) return;

    setAttachmentError(null);
    let transcript = "";
    if (attached) {
      setAttachmentTranscribing(true);
      try {
        const wav = await audioFileToWav(attached);
        const result = await window.electron.recording.transcribe(wav);
        if ("error" in result) {
          setAttachmentError(result.error);
          return;
        }
        transcript = result.text.trim();
        if (!transcript) {
          setAttachmentError("Unable to transcribe attached audio.");
          return;
        }
      } catch (err) {
        setAttachmentError(err instanceof Error ? err.message : "Unable to read attached audio.");
        return;
      } finally {
        setAttachmentTranscribing(false);
      }
    }

    const messageText =
      text && transcript
        ? `${text}\n\n${transcript}`
        : text || transcript;
    if (!messageText) return;

    setInput("");
    setAttachedAudioFile(null);
    await sendText(messageText);
  }, [attachedAudioFile, attachmentTranscribing, input, sendText]);

  const generateReply = useCallback(async () => {
    if (!conversationId) return;
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
      backend: () => window.electron.chat.generateReply(conversationId),
    });
  }, [appendAssistantPlaceholder, beginNewTurn, conversationId, makeMessageId, runAssistantTurn]);

  const saveMessageToNotes = useCallback(
    async (messageId: string, content: string) => {
      const trimmed = content.trim();
      if (!trimmed) return;
      try {
        const note = await window.electron.notes.create(undefined, trimmed);
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

  // Stable ref so the pendingHotkeyText effect always calls the latest sendText without it being a dep
  const sendTextRef = useRef(sendText);
  useEffect(() => {
    sendTextRef.current = sendText;
  });

  // Global hotkey finished transcription — inject into this chat (send or pre-fill per settings, unless draft-only)
  useEffect(() => {
    if (!pendingHotkeyText || !conversationId) return;
    window.electron.settings.get().then((s) => {
      const autoSend = (s as { recording?: { autoSend: boolean } }).recording?.autoSend ?? true;
      if (autoSend && !pendingHotkeyDraftOnly) {
        sendTextRef.current(pendingHotkeyText, { fromDictation: true });
      } else {
        setInput((prev) => (prev ? prev + " " + pendingHotkeyText : pendingHotkeyText));
      }
      onPendingHotkeyTextConsumed?.();
    });
  // Only re-run when the text itself changes (or conversationId changes underneath it)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHotkeyText, conversationId, pendingHotkeyDraftOnly]);

  const startRecording = useCallback(async () => {
    setVoiceError(null);
    setRecordingMs(0);
    try {
      await recorder.start();
      setVoiceState("recording");
      transcriptionCancelledRef.current = false;
      recordingStartRef.current = Date.now();
      recordingTimerRef.current = setInterval(() => {
        const elapsed = Date.now() - recordingStartRef.current;
        setRecordingMs(elapsed);
        if (elapsed >= MAX_RECORDING_MS) {
          if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
          }
          void stopAndTranscribe();
        }
      }, 33);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Microphone access denied.");
    }
  }, [recorder, MAX_RECORDING_MS]);

  const stopAndTranscribe = useCallback(async () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setVoiceState("processing");
    setVoiceError(null);
    transcriptionCancelledRef.current = false;
    try {
      const wav = await recorder.stop();
      window.electron.recording.saveWav(wav).catch(() => {});
      const requestId = crypto.randomUUID();
      transcriptionRequestIdRef.current = requestId;
      const result = await window.electron.recording.transcribe(wav, { requestId });
      if (transcriptionCancelledRef.current || transcriptionRequestIdRef.current !== requestId) {
        return;
      }
      if ("error" in result) {
        setVoiceError(result.error);
      } else {
        const text = result.text.trim();
        if (!text) return;
        const s = await window.electron.settings.get() as { recording?: { autoSend: boolean } };
        if (s.recording?.autoSend ?? true) {
          sendTextRef.current(text, { fromDictation: true });
        } else {
          setInput((prev) => (prev ? prev + " " + text : text));
        }
      }
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Recording failed.");
    } finally {
      transcriptionRequestIdRef.current = null;
      setVoiceState("idle");
    }
  }, [recorder]);

  const cancelRecording = useCallback(async () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (voiceState === "processing" && transcriptionRequestIdRef.current) {
      transcriptionCancelledRef.current = true;
      void window.electron.recording.cancelTranscription(transcriptionRequestIdRef.current).catch(() => {});
      transcriptionRequestIdRef.current = null;
    }
    try {
      if (voiceState === "recording") {
        await recorder.stop();
      }
    } catch (_) { /* already stopped */ }
    setVoiceState("idle");
    setVoiceError(null);
    setRecordingMs(0);
    playCancelChime();
  }, [recorder, voiceState]);

  const openTitleModal = useCallback(() => {
    setTitleDraft(displayTitle);
    setTitleModalOpen(true);
  }, [displayTitle]);

  const saveConversationTitle = useCallback(async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || !conversationId) return;
    setTitleSaving(true);
    try {
      await window.electron.memory.setConversationTitle(conversationId, trimmed);
      onConversationCreated();
      setTitleModalOpen(false);
    } finally {
      setTitleSaving(false);
    }
  }, [titleDraft, conversationId, onConversationCreated]);

  if (!conversationId) {
    return (
      <div className="chat-pane">
        <div className="chat-scroll chat-scroll--placeholder">
          <div className="chat-area-inner">Select a conversation or create a new one.</div>
        </div>
      </div>
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
        headerCornerControl={(
          <button
            type="button"
            className="btn btn-icon chat-pane-window-toggle"
            onClick={onWindowSizeToggle}
            aria-label="Shrink window"
            title="Shrink window"
          >
            <Minimize2 size={14} />
          </button>
        )}
        displayMessages={messages}
        copiedId={copiedId}
        savedToNotesId={savedToNotesId}
        onCopied={setCopiedId}
        onSaveToNotes={saveMessageToNotes}
        streamingContent={streamingContent}
        sending={sending}
        polishHintAfterDictation={polishHintAfterDictation}
        onToolConfirm={handleToolConfirm}
        onPolish={polishLastUserFromStrip}
        onGenerateReply={generateReply}
        inputRef={inputRef}
        input={input}
        onInputChange={setInput}
        onSend={send}
        onStop={() => {
          const turnId = activeTurnIdRef.current;
          streamAbortRef.current?.abort();
          void window.electron.chat.stop().catch(() => {});
          if (turnId != null) completeTurn(turnId);
        }}
        voiceState={voiceState}
        voiceError={voiceError}
        recordingMs={recordingMs}
        onStartRecording={startRecording}
        onStopRecording={stopAndTranscribe}
        onCancelRecording={cancelRecording}
        attachedAudioName={attachedAudioFile?.name ?? null}
        attachmentTranscribing={attachmentTranscribing}
        attachmentError={attachmentError}
        onAttachAudio={(file) => {
          setAttachedAudioFile(file);
          setAttachmentError(null);
        }}
        onRemoveAttachedAudio={() => {
          setAttachedAudioFile(null);
          setAttachmentError(null);
        }}
        focusComposerNonce={focusComposerNonce}
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
    </>
  );
}
