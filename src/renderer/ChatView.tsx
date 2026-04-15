import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import type { UIEvent, CSSProperties } from "react";
import { useRecorder } from "./useRecorder";
import { playCancelChime } from "./recordingUtils";
import { OPENAI_CHAT_MODEL } from "../shared/openaiModels";
import { DICTATION_POLISH_INSTRUCTION } from "../shared/dictationPolish";
import { ChatMessageList } from "./ChatMessageList";
import { ChatComposer } from "./ChatComposer";
import { ChatTitleModal } from "./ChatTitleModal";
import {
  type Message,
  type ToolCallDisplay,
  type VoiceState,
  SCROLL_TOP_THRESHOLD,
  BOTTOM_SPACER_BEYOND_COMPOSER_PX,
} from "./chatHelpers";

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
  const [streamingContent, setStreamingContent] = useState("");
  const [sending, setSending] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [activeChatModel, setActiveChatModel] = useState("");
  const [streamingMeta, setStreamingMeta] = useState<{ model: string; startedAt: number } | null>(null);
  const streamingMetaRef = useRef<{ model: string; startedAt: number } | null>(null);
  const activeChatModelRef = useRef("");

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  /** After plain dictation, show polish next to reply (polish targets the dictated turn only). */
  const [polishHintAfterDictation, setPolishHintAfterDictation] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [titleModalOpen, setTitleModalOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);
  const [recordingMs, setRecordingMs] = useState(0);
  const recordingStartRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recorder = useRecorder();

  /** Tool calls for the assistant turn currently being streamed; shown inline and then stored on the message when stream ends. */
  const [currentTurnToolCalls, setCurrentTurnToolCalls] = useState<ToolCallDisplay[]>([]);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const streamingContentRef = useRef("");
  const currentTurnToolCallsRef = useRef<ToolCallDisplay[]>([]);
  const [bottomSpacerPx, setBottomSpacerPx] = useState(200);

  useEffect(() => {
    streamingContentRef.current = streamingContent;
  }, [streamingContent]);
  useEffect(() => {
    currentTurnToolCallsRef.current = currentTurnToolCalls;
  }, [currentTurnToolCalls]);
  useEffect(() => {
    streamingMetaRef.current = streamingMeta;
  }, [streamingMeta]);

  useEffect(() => {
    activeChatModelRef.current = activeChatModel;
  }, [activeChatModel]);

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
      setMessages([]);
      return;
    }

    setMessages([]);
    setStreamingContent("");
    setCurrentTurnToolCalls([]);
    setSending(false);
    setInput("");
    setCopiedIndex(null);
    setVoiceError(null);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setVoiceState("idle");
    setPolishHintAfterDictation(false);
    setStreamingMeta(null);
    setTitleModalOpen(false);

    let cancelled = false;
    window.electron.memory.getMessages(conversationId).then((list) => {
      if (cancelled) return;
      setMessages(
        list.map((m) => ({
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
      if (cid !== conversationId) return;
      setCurrentTurnToolCalls((prev) => [...prev, { toolName, payload }]);
    });
    return () => {
      unsub();
    };
  }, [conversationId]);

  // Single list: show streaming as the last "message" so we don't replace the block on stream end (avoids scroll jump)
  const displayMessages: Message[] =
    streamingContent.length > 0 || currentTurnToolCalls.length > 0
      ? [
          ...messages,
          {
            role: "assistant",
            content: streamingContent,
            toolCalls: currentTurnToolCalls.length > 0 ? currentTurnToolCalls : undefined,
            model: streamingMeta?.model ?? activeChatModel,
            timestamp: streamingMeta?.startedAt ?? Date.now(),
          },
        ]
      : messages;

  useLayoutEffect(() => {
    const composer = composerRef.current;
    const chatArea = chatAreaRef.current;
    if (!composer || !chatArea) return;
    const update = () => {
      const composerHeight = Math.ceil(composer.getBoundingClientRect().height);
      const measured = composerHeight + BOTTOM_SPACER_BEYOND_COMPOSER_PX;
      setBottomSpacerPx((prev) => (prev !== measured ? measured : prev));
    };
    update();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(composer);
    }
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const unsubChunk = window.electron.chat.onStreamChunk((cid, chunk) => {
      if (cid === conversationId) setStreamingContent((prev) => prev + chunk);
    });
    const unsubEnd = window.electron.chat.onStreamEnd((cid) => {
      if (cid === conversationId) {
        const finalContent = streamingContentRef.current;
        const toolCalls = currentTurnToolCallsRef.current.length > 0 ? [...currentTurnToolCallsRef.current] : undefined;
        const model = streamingMetaRef.current?.model ?? activeChatModelRef.current;
        setMessages((prev) =>
          finalContent || toolCalls
            ? [
                ...prev,
                {
                  role: "assistant",
                  content: finalContent || "",
                  toolCalls,
                  model: model || undefined,
                  timestamp: Date.now(),
                },
              ]
            : prev
        );
        setStreamingContent("");
        setCurrentTurnToolCalls([]);
        setStreamingMeta(null);
        setSending(false);
      }
    });
    return () => {
      unsubChunk();
      unsubEnd();
    };
  }, [conversationId]);

  const onChatAreaScroll = useCallback((_e: UIEvent<HTMLDivElement>) => {
    const el = chatAreaRef.current;
    if (!el) return;
    setHasScrolled(el.scrollTop > SCROLL_TOP_THRESHOLD);
  }, []);

  const scrollToTop = useCallback(() => {
    chatAreaRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

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
      if (!text.trim() || !conversationId || sending) return;
      if (opts?.fromDictation) setPolishHintAfterDictation(true);
      else setPolishHintAfterDictation(false);
      setSending(true);
      setStreamingContent("");
      setCurrentTurnToolCalls([]);
      const userTs = Date.now();
      setMessages((prev) => [...prev, { role: "user", content: text, timestamp: userTs }]);
      setStreamingMeta({ model: activeChatModelRef.current, startedAt: Date.now() });
      try {
        await window.electron.chat.send(conversationId, text);
        onConversationCreated();
      } catch (e) {
        setStreamingContent(`[Error: ${e instanceof Error ? e.message : String(e)}]`);
        setStreamingMeta(null);
        setSending(false);
      }
    },
    [conversationId, sending, onConversationCreated]
  );

  /** Post-strip polish: replace last user dictation with instruction + same text, then stream. */
  const polishLastUserFromStrip = useCallback(async () => {
    if (!conversationId || sending) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || !last.content?.trim()) return;
    setPolishHintAfterDictation(false);
    const instruction = DICTATION_POLISH_INSTRUCTION;
    const t1 = Date.now();
    const t2 = t1 + 1;
    const transcript = last.content;
    setSending(true);
    setStreamingContent("");
    setCurrentTurnToolCalls([]);
    setMessages((prev) => [
      ...prev.slice(0, -1),
      { role: "user", content: instruction, timestamp: t1 },
      { role: "user", content: transcript, timestamp: t2 },
    ]);
    setStreamingMeta({ model: activeChatModelRef.current, startedAt: Date.now() });
    try {
      await window.electron.chat.polishLastUser(conversationId);
      onConversationCreated();
    } catch (e) {
      setStreamingContent(`[Error: ${e instanceof Error ? e.message : String(e)}]`);
      setStreamingMeta(null);
      setSending(false);
      void window.electron.memory.getMessages(conversationId).then((list) => {
        setMessages(
          list.map((m) => ({
            role: m.role,
            content: m.content,
            toolCalls: (m as Message).toolCalls,
            timestamp: (m as Message).timestamp,
            model: (m as Message).model,
          }))
        );
      });
    }
  }, [conversationId, sending, messages, onConversationCreated]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendText(text);
  }, [input, sendText]);

  const generateReply = useCallback(async () => {
    if (!conversationId || sending) return;
    setSending(true);
    setStreamingContent("");
    setCurrentTurnToolCalls([]);
    setStreamingMeta({ model: activeChatModelRef.current, startedAt: Date.now() });
    try {
      await window.electron.chat.generateReply(conversationId);
      onConversationCreated();
    } catch (e) {
      setStreamingContent(`[Error: ${e instanceof Error ? e.message : String(e)}]`);
      setStreamingMeta(null);
      setSending(false);
    }
  }, [conversationId, sending, onConversationCreated]);

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
      <div className="chat-area" style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-muted)" }}>
        <div className="chat-area-inner" style={{ textAlign: "center" }}>
          Select a conversation or create a new one.
        </div>
      </div>
    );
  }

  return (
    <div
      ref={chatAreaRef}
      className="chat-scroll"
      data-scrolled={hasScrolled || undefined}
      onScroll={onChatAreaScroll}
      style={{ "--chat-bottom-spacer": `${bottomSpacerPx}px` } as CSSProperties}
    >
      {hasScrolled && (
        <button
          type="button"
          className="chat-scroll-top"
          onClick={scrollToTop}
          aria-label="Scroll to top"
        >
          Top
        </button>
      )}
      <header className="chat-pane-header">
        <button
          type="button"
          className="btn chat-pane-title"
          onClick={openTitleModal}
          title="Edit title"
        >
          {displayTitle}
        </button>
      </header>
      <div className="chat-area">
        <div className="chat-area-inner" data-testid="chat-messages">
          <ChatMessageList
            displayMessages={displayMessages}
            copiedIndex={copiedIndex}
            onCopied={setCopiedIndex}
            streamingContent={streamingContent}
            sending={sending}
            polishHintAfterDictation={polishHintAfterDictation}
            onToolConfirm={handleToolConfirm}
            onPolish={polishLastUserFromStrip}
            onGenerateReply={generateReply}
          />
        </div>
      </div>
      <div ref={composerRef} className="input-container input-container--sticky" data-testid="chat-composer">
        <ChatComposer
          input={input}
          onInputChange={setInput}
          onSend={send}
          onStop={() => window.electron.chat.stop()}
          sending={sending}
          voiceState={voiceState}
          voiceError={voiceError}
          recordingMs={recordingMs}
          onStartRecording={startRecording}
          onStopRecording={stopAndTranscribe}
          onCancelRecording={cancelRecording}
          focusComposerNonce={focusComposerNonce}
        />
      </div>

      <ChatTitleModal
        open={titleModalOpen}
        onClose={() => setTitleModalOpen(false)}
        titleDraft={titleDraft}
        onTitleDraftChange={setTitleDraft}
        onSave={() => void saveConversationTitle()}
        saving={titleSaving}
      />
    </div>
  );
}
