import { useState, useEffect, useRef, useCallback } from "react";
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
}

export function ChatView({
  conversationId,
  displayTitle,
  onConversationCreated,
  pendingHotkeyText,
  pendingHotkeyDraftOnly,
  onPendingHotkeyTextConsumed,
  onChatActivityChange,
  focusComposerNonce,
}: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<string | null>(null);
  const [isTurnPending, setIsTurnPending] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeChatModel, setActiveChatModel] = useState("");
  const [streamingMeta, setStreamingMeta] = useState<{ model: string; startedAt: number } | null>(null);
  const streamingMetaRef = useRef<{ model: string; startedAt: number } | null>(null);
  const activeChatModelRef = useRef("");
  const conversationIdRef = useRef<string | null>(conversationId);
  const sendingRef = useRef(false);
  const isTurnPendingRef = useRef(false);
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
    isTurnPendingRef.current = isTurnPending;
  }, [isTurnPending]);
  useEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);
  useEffect(() => {
    streamingMetaRef.current = streamingMeta;
  }, [streamingMeta]);

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
    setIsTurnPending(false);
    setIsStreaming(false);
    setActiveAssistantMessageId(null);
    setStreamingMeta(null);
    requestAnimationFrame(() => inputRef.current?.focus());
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
    setStreamingMeta({ model: activeChatModelRef.current, startedAt: Date.now() });
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
    setActiveAssistantMessageId(null);
    setIsTurnPending(false);
    setIsStreaming(false);
    setInput("");
    setCopiedId(null);
    setVoiceError(null);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setVoiceState("idle");
    setAttachedAudioFile(null);
    setAttachmentTranscribing(false);
    setAttachmentError(null);
    setPolishHintAfterDictation(false);
    setStreamingMeta(null);
    setTitleModalOpen(false);

    let cancelled = false;
    window.electron.memory.getMessages(conversationId).then((list) => {
      if (cancelled) return;
      setMessages(
        list.map((m, i) => ({
          id: `${(m as Message).role === "assistant" ? "assistant" : "history"}-${(m as Message).timestamp ?? Date.now()}-${i}`,
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
      const assistantId = activeAssistantMessageId;
      const turnId = activeTurnIdRef.current;
      const signal = streamAbortRef.current?.signal;
      if (!assistantId || turnId == null || !isTurnCurrent(turnId, signal)) return;
      applyAssistantChunk(assistantId, (prev) => prev + chunk);
    });
    const unsubEnd = window.electron.chat.onStreamEnd((cid) => {
      if (cid !== conversationIdRef.current) return;
      const turnId = activeTurnIdRef.current;
      if (turnId == null) return;
      completeTurn(turnId);
    });
    return () => {
      unsubChunk();
      unsubEnd();
    };
  }, [activeAssistantMessageId, applyAssistantChunk, completeTurn, isTurnCurrent]);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      activeTurnIdRef.current = null;
      void window.electron.chat.stop().catch(() => {});
    };
  }, []);

  const displayMessages: Message[] = messages;
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
      setActiveAssistantMessageId(null);
      setMessages((prev) => [
        ...prev,
        { id: userMessageId, role: "user", content: text, timestamp: Date.now() },
      ]);
      if (!isTurnCurrent(turnId, signal)) return;

      setActiveAssistantMessageId(assistantMessageId);
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          toolCalls: [],
          model: streamingMetaRef.current?.model ?? activeChatModelRef.current,
          timestamp: Date.now(),
        },
      ]);
      if (!isTurnCurrent(turnId, signal)) return;

      setIsTurnPending(false);
      setIsStreaming(true);
      requestAnimationFrame(() => inputRef.current?.focus());
      try {
        await window.electron.chat.send(conversationId, text);
        onConversationCreated();
      } catch (e) {
        const wasAborted = signal.aborted || String(e).toLowerCase().includes("abort");
        if (wasAborted) {
          completeTurn(turnId);
          return;
        }
        if (!isTurnCurrent(turnId, signal)) return;
        const errorText = `[Error: ${e instanceof Error ? e.message : String(e)}]`;
        applyAssistantChunk(assistantMessageId, () => errorText);
        completeTurn(turnId);
      }
    },
    [
      applyAssistantChunk,
      beginNewTurn,
      completeTurn,
      conversationId,
      isTurnCurrent,
      makeMessageId,
      onConversationCreated,
    ]
  );

  const onMessageRef = useCallback((id: string, node: HTMLDivElement | null) => {
    void id;
    void node;
  }, []);

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
    setActiveAssistantMessageId(null);
    setMessages((prev) => [
      ...prev.slice(0, -1),
      { id: instructionId, role: "user", content: instruction, timestamp: t1 },
      { id: transcriptId, role: "user", content: transcript, timestamp: t2 },
    ]);
    if (!isTurnCurrent(turnId, signal)) return;
    setActiveAssistantMessageId(assistantMessageId);
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        toolCalls: [],
        model: streamingMetaRef.current?.model ?? activeChatModelRef.current,
        timestamp: Date.now(),
      },
    ]);
    if (!isTurnCurrent(turnId, signal)) return;
    setIsTurnPending(false);
    setIsStreaming(true);
    try {
      await window.electron.chat.polishLastUser(conversationId);
      onConversationCreated();
    } catch (e) {
      const wasAborted = signal.aborted || String(e).toLowerCase().includes("abort");
      if (wasAborted) {
        completeTurn(turnId);
        return;
      }
      if (!isTurnCurrent(turnId, signal)) return;
      const errorText = `[Error: ${e instanceof Error ? e.message : String(e)}]`;
      applyAssistantChunk(assistantMessageId, () => errorText);
      completeTurn(turnId);
      void window.electron.memory.getMessages(conversationId).then((list) => {
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
    }
  }, [applyAssistantChunk, beginNewTurn, completeTurn, conversationId, isTurnCurrent, makeMessageId, onConversationCreated]);

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
    const latestUserId =
      [...messagesRef.current]
        .reverse()
        .find((message) => message.role === "user")?.id ?? null;
    setActiveAssistantMessageId(assistantMessageId);
    setMessages((prev) => [
      ...prev,
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        toolCalls: [],
        model: streamingMetaRef.current?.model ?? activeChatModelRef.current,
        timestamp: Date.now(),
      },
    ]);
    void latestUserId;
    setIsTurnPending(false);
    setIsStreaming(true);
    try {
      await window.electron.chat.generateReply(conversationId);
      onConversationCreated();
    } catch (e) {
      const wasAborted = signal.aborted || String(e).toLowerCase().includes("abort");
      if (wasAborted) {
        completeTurn(turnId);
        return;
      }
      if (!isTurnCurrent(turnId, signal)) return;
      const errorText = `[Error: ${e instanceof Error ? e.message : String(e)}]`;
      applyAssistantChunk(assistantMessageId, () => errorText);
      completeTurn(turnId);
    }
  }, [applyAssistantChunk, beginNewTurn, completeTurn, conversationId, isTurnCurrent, makeMessageId, onConversationCreated]);

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
      recordingStartRef.current = Date.now();
      recordingTimerRef.current = setInterval(() => {
        setRecordingMs(Date.now() - recordingStartRef.current);
      }, 33);
    } catch (err) {
      setVoiceError(err instanceof Error ? err.message : "Microphone access denied.");
    }
  }, [recorder]);

  const stopAndTranscribe = useCallback(async () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    setVoiceState("processing");
    setVoiceError(null);
    try {
      const wav = await recorder.stop();
      window.electron.recording.saveWav(wav).catch(() => {});
      const result = await window.electron.recording.transcribe(wav);
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
      setVoiceState("idle");
    }
  }, [recorder]);

  const cancelRecording = useCallback(async () => {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    try { await recorder.stop(); } catch (_) { /* already stopped */ }
    setVoiceState("idle");
    setVoiceError(null);
    setRecordingMs(0);
    playCancelChime();
  }, [recorder]);

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
          >
            {displayTitle}
          </button>
        )}
        displayMessages={displayMessages}
        copiedId={copiedId}
        onCopied={setCopiedId}
        streamingContent={streamingContent}
        sending={sending}
        polishHintAfterDictation={polishHintAfterDictation}
        onToolConfirm={handleToolConfirm}
        onPolish={polishLastUserFromStrip}
        onGenerateReply={generateReply}
        onMessageRef={onMessageRef}
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
