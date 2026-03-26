import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import type { UIEvent, WheelEvent } from "react";
import { Copy, Check, Mic, Square, Loader2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useRecorder } from "./useRecorder";
import { playCancelChime } from "./recordingUtils";

interface ToolCallDisplay {
  toolName: string;
  payload?: unknown;
}

interface Message {
  role: string;
  content: string;
  toolCalls?: ToolCallDisplay[];
  timestamp?: number;
  model?: string;
}

function formatMessageTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

interface ChatViewProps {
  conversationId: string | null;
  onConversationCreated: () => void;
  /** Text from the global hotkey — send vs pre-fill follows recording.autoSend unless draft-only. */
  pendingHotkeyText?: string | null;
  /** If true, always pre-fill input (never auto-send), e.g. recording stopped while the app was unfocused. */
  pendingHotkeyDraftOnly?: boolean;
  onPendingHotkeyTextConsumed?: () => void;
  /** Fires when this chat is waiting on / streaming from the model (not composer voice). */
  onChatActivityChange?: (active: boolean) => void;
}

/** Renders markdown (bold, lists, code, etc.) without headers (they render as paragraphs). */
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children, ...props }) => <p {...props}>{children}</p>,
        h2: ({ children, ...props }) => <p {...props}>{children}</p>,
        h3: ({ children, ...props }) => <p {...props}>{children}</p>,
        h4: ({ children, ...props }) => <p {...props}>{children}</p>,
        h5: ({ children, ...props }) => <p {...props}>{children}</p>,
        h6: ({ children, ...props }) => <p {...props}>{children}</p>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    task_list: "Reviewed tasks",
    task_create: "Created task",
    task_update: "Updated task",
    task_delete: "Deleted task",
    task_clear_completed: "Cleared completed",
    memory_set_fact: "Updated memory",
    memory_list_facts: "Listed memories",
    memory_search_conversations: "Searched history",
    get_datetime: "Checked date & time",
  };
  return labels[name] ?? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Secondary line for tool cards (e.g. task title after create/update). */
function toolCallDetail(toolName: string, payload: unknown): string | null {
  if (payload == null || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  if (p.pending === true && p.args && typeof p.args === "object") {
    const args = p.args as Record<string, unknown>;
    if (toolName === "task_update" && typeof args.title === "string" && args.title.trim()) {
      return args.title.trim();
    }
    return null;
  }
  if (p.cancelled === true) return null;

  if (toolName === "task_create" || toolName === "task_update") {
    if (typeof p.error === "string" && p.error) return p.error;
    const ids = p.affectedIds as string[] | undefined;
    const tasks = p.tasks as Array<{ id: string; title: string }> | undefined;
    if (ids?.length && Array.isArray(tasks)) {
      const id = ids[0];
      const t = tasks.find((x) => x.id === id);
      if (t?.title) return t.title;
    }
  }

  return null;
}

function CopyButton({ content, messageIndex, copiedIndex, onCopied }: { content: string; messageIndex: number; copiedIndex: number | null; onCopied: (i: number | null) => void }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      onCopied(messageIndex);
      setTimeout(() => onCopied(null), 2000);
    } catch (_) {
      /* ignore */
    }
  };
  const justCopied = copiedIndex === messageIndex;
  return (
    <button
      type="button"
      className="message-copy-btn"
      onClick={handleCopy}
      title={justCopied ? "Copied!" : "Copy"}
      aria-label={justCopied ? "Copied!" : "Copy message"}
    >
      {justCopied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

const SCROLL_TOP_THRESHOLD = 24;
/** If the viewport is within this many px of the bottom, streaming updates keep it pinned there. */
const STREAM_NEAR_BOTTOM_PX = 120;

type VoiceState = "idle" | "recording" | "processing";

export function ChatView({
  conversationId,
  onConversationCreated,
  pendingHotkeyText,
  pendingHotkeyDraftOnly,
  onPendingHotkeyTextConsumed,
  onChatActivityChange,
}: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [sending, setSending] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [expandedUserCards, setExpandedUserCards] = useState<Set<number>>(new Set());
  const [overflowedUserCards, setOverflowedUserCards] = useState<Set<number>>(new Set());
  const [hasScrolled, setHasScrolled] = useState(false);
  const [scrollOnStream, setScrollOnStream] = useState(true);
  const userCardContentRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [activeChatModel, setActiveChatModel] = useState("");
  const [streamingMeta, setStreamingMeta] = useState<{ model: string; startedAt: number } | null>(null);
  const streamingMetaRef = useRef<{ model: string; startedAt: number } | null>(null);
  const activeChatModelRef = useRef("");

  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
  const recordingStartRef = useRef<number>(0);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const recorder = useRecorder();

  /** Tool calls for the assistant turn currently being streamed; shown inline and then stored on the message when stream ends. */
  const [currentTurnToolCalls, setCurrentTurnToolCalls] = useState<ToolCallDisplay[]>([]);
  const prevSendingRef = useRef(false);
  /** True while the user is following the latest content (updated on scroll; not inferred from layout after content grows). */
  const stickToBottomRef = useRef(true);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingContentRef = useRef("");
  const currentTurnToolCallsRef = useRef<ToolCallDisplay[]>([]);

  const toggleUserCardExpanded = useCallback((index: number) => {
    setExpandedUserCards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

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
    window.electron.settings.get().then((s) => {
      const settings = s as {
        activeProvider: string;
        openai?: { model?: string };
        ollama?: { model?: string };
        chat?: { scrollOnStream?: boolean };
      };
      const m =
        settings.activeProvider === "ollama"
          ? (settings.ollama?.model ?? "")
          : (settings.openai?.model ?? "");
      setActiveChatModel(m);
      setScrollOnStream(settings.chat?.scrollOnStream ?? true);
    });
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
    setExpandedUserCards(new Set());
    setOverflowedUserCards(new Set());
    userCardContentRefs.current = {};
    setVoiceError(null);
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    setVoiceState("idle");
    setStreamingMeta(null);
    prevSendingRef.current = false;
    stickToBottomRef.current = true;

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
    if (conversationId) {
      inputRef.current?.focus();
    }
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

  const scrollChatToBottom = useCallback(() => {
    const el = chatAreaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight - el.clientHeight;
  }, []);

  /** When a reply starts, follow the new turn (if setting is on). */
  useLayoutEffect(() => {
    if (scrollOnStream && sending && !prevSendingRef.current) {
      stickToBottomRef.current = true;
      scrollChatToBottom();
    }
    prevSendingRef.current = sending;
  }, [sending, scrollOnStream, scrollChatToBottom]);

  /**
   * While streaming, keep the viewport pinned only when the user is still following the stream.
   * We cannot infer "near bottom" from scroll metrics after content grows (scrollHeight increases but scrollTop is unchanged).
   */
  useLayoutEffect(() => {
    if (!scrollOnStream || !sending || !stickToBottomRef.current) return;
    scrollChatToBottom();
    // Second pass: markdown/layout can change scrollHeight after the first paint.
    const id = requestAnimationFrame(() => scrollChatToBottom());
    return () => cancelAnimationFrame(id);
  }, [streamingContent, currentTurnToolCalls, displayMessages, sending, scrollOnStream, scrollChatToBottom]);

  useLayoutEffect(() => {
    const next = new Set<number>();
    displayMessages.forEach((m, i) => {
      if (m.role !== "user") return;
      if (expandedUserCards.has(i)) return;
      const el = userCardContentRefs.current[i];
      if (el && el.scrollHeight > el.clientHeight) next.add(i);
    });
    setOverflowedUserCards((prev) =>
      prev.size !== next.size || [...prev].some((n) => !next.has(n)) ? next : prev
    );
  }, [displayMessages, expandedUserCards]);

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

  // Auto-grow textarea to fit content (up to CSS max-height)
  const adjustInputHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustInputHeight();
  }, [input, adjustInputHeight]);

  const onChatAreaScroll = useCallback((e: UIEvent<HTMLDivElement>) => {
    const el = chatAreaRef.current;
    if (!el) return;
    setHasScrolled(el.scrollTop > SCROLL_TOP_THRESHOLD);
    // Programmatic scrollTop updates also fire `scroll` with isTrusted false; ignore those so we
    // don't flip back to "following" after the user scrolled away.
    if (!e.nativeEvent.isTrusted) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distFromBottom <= STREAM_NEAR_BOTTOM_PX;
  }, []);

  /** Wheel runs before layout; clears follow immediately so the next stream chunk can't scroll first. */
  const onChatWheelCapture = useCallback((e: WheelEvent<HTMLDivElement>) => {
    if (!scrollOnStream || !sending) return;
    if (!e.nativeEvent.isTrusted) return;
    // Standard wheel: negative deltaY = scroll toward older messages (up). Ignore mostly-horizontal trackpad pans.
    if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
    if (e.deltaY < 0) stickToBottomRef.current = false;
  }, [scrollOnStream, sending]);

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
        // Gated tool: main process will run the tool on proceed and resume the agent; we only resolve and update UI.
        try {
          await window.electron.chat.resolveGatedTool(pendingId, action);
        } catch {
          // ignore; stream may have been stopped
        }
      }

      // Mark this tool call as no longer pending (and optionally cancelled) in local state
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
  const sendText = useCallback(async (text: string) => {
    if (!text.trim() || !conversationId || sending) return;
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
  }, [conversationId, sending, onConversationCreated]);

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
  useEffect(() => { sendTextRef.current = sendText; });

  // Global hotkey finished transcription — inject into this chat (send or pre-fill per settings, unless draft-only)
  useEffect(() => {
    if (!pendingHotkeyText || !conversationId) return;
    window.electron.settings.get().then((s) => {
      const autoSend = (s as { recording?: { autoSend: boolean } }).recording?.autoSend ?? true;
      if (autoSend && !pendingHotkeyDraftOnly) {
        sendTextRef.current(pendingHotkeyText);
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
          sendTextRef.current(text);
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
      onWheelCapture={onChatWheelCapture}
    >
      {hasScrolled && (
        <button
          type="button"
          className="chat-scroll-top"
          onClick={scrollToTop}
          aria-label="Scroll to top"
        >
          top
        </button>
      )}
      <div className="chat-area">
        <div className="chat-area-inner" data-testid="chat-messages">
          {displayMessages.map((m, i) => {
            const isAssistant = m.role === "assistant";
            const hasToolCalls = isAssistant && m.toolCalls && m.toolCalls.length > 0;

            return (
              <div key={i} className={`message-block ${m.role}`}>
                <div className="content">
                  {m.role === "user" ? (
                    <div className={`message-user-card${expandedUserCards.has(i) ? " message-user-card--expanded" : ""}`}>
                      <div className="message-user-card__content" ref={(el) => { userCardContentRefs.current[i] = el; }}>
                        {m.content ? <MarkdownContent content={m.content} /> : null}
                      </div>
                      {(expandedUserCards.has(i) || overflowedUserCards.has(i)) && (
                        <button
                          type="button"
                          className="message-user-card__toggle"
                          onClick={() => toggleUserCardExpanded(i)}
                          aria-expanded={expandedUserCards.has(i)}
                        >
                          {expandedUserCards.has(i) ? "Show less" : "Show more"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {hasToolCalls && (
                        <div className="tool-card">
                          {m.toolCalls!.map((call, j) => {
                            const p = call.payload as { pending?: boolean } | undefined;
                            const isPending = !!p?.pending;
                            const detail = toolCallDetail(call.toolName, call.payload);
                            return (
                              <div key={j} className="tool-card-row">
                                <div className="tool-card-row-text">
                                  <span className="tool-card-label">{toolLabel(call.toolName)}</span>
                                  {detail ? (
                                    <span className="tool-card-detail" title={detail}>
                                      {detail}
                                    </span>
                                  ) : null}
                                </div>
                                {isPending && (
                                  <span className="tool-card-actions">
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => handleToolConfirm(call, "proceed")}
                                    >
                                      Proceed
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => handleToolConfirm(call, "cancel")}
                                    >
                                      Cancel
                                    </button>
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {m.content ? <MarkdownContent content={m.content} /> : null}
                    </>
                  )}
                </div>
                <div className="message-block-footer">
                  <div className="message-block-meta">
                    {m.role === "user" ? (
                      <>
                        <span>You</span>
                        <span className="message-block-meta-sep" aria-hidden="true">
                          ·
                        </span>
                        <span className="message-block-meta-time">{formatMessageTime(m.timestamp!)}</span>
                      </>
                    ) : (
                      <>
                        <span className="message-block-meta-model">{m.model}</span>
                        <span className="message-block-meta-sep" aria-hidden="true">
                          ·
                        </span>
                        <span className="message-block-meta-time">{formatMessageTime(m.timestamp!)}</span>
                      </>
                    )}
                  </div>
                  <CopyButton
                    content={m.content}
                    messageIndex={i}
                    copiedIndex={copiedIndex}
                    onCopied={setCopiedIndex}
                  />
                </div>
              </div>
            );
          })}
          {displayMessages.length > 0 &&
            displayMessages[displayMessages.length - 1].role === "user" &&
            !streamingContent && (
              <div className="get-reply-prompt">
                {sending ? (
                  <span className="voice-status">
                    <Loader2 size={13} className="voice-spinner" />
                    Replying…
                  </span>
                ) : (
                  <button type="button" className="btn btn-get-reply" onClick={generateReply}>
                    Get reply
                  </button>
                )}
              </div>
            )}
        </div>
      </div>
      <div className="input-container input-container--sticky" data-testid="chat-composer">
        {voiceError && (
          <div className="voice-error">{voiceError}</div>
        )}
        <textarea
          ref={inputRef}
          className="chat-input"
          data-testid="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type a message..."
          disabled={sending || voiceState === "recording" || voiceState === "processing"}
          rows={1}
        />
        <div className="input-actions">
          <div className="voice-controls">
            {voiceState === "idle" && (
              <button
                type="button"
                className="btn btn-icon voice-btn"
                onClick={startRecording}
                disabled={sending}
                title="Record voice message"
                aria-label="Start recording"
              >
                <Mic size={15} />
              </button>
            )}
            {voiceState === "recording" && (
              <>
                <button
                  type="button"
                  className="btn btn-icon voice-btn voice-btn--recording"
                  onClick={stopAndTranscribe}
                  title="Stop recording"
                  aria-label="Stop recording"
                >
                  <Square size={13} />
                </button>
                <span className="voice-timer">
                  {`${Math.floor(recordingMs / 60000)}:${String(Math.floor((recordingMs % 60000) / 1000)).padStart(2, "0")}.${String(recordingMs % 1000).padStart(3, "0")}`}
                </span>
              </>
            )}
            {voiceState === "processing" && (
              <span className="voice-status">
                <Loader2 size={13} className="voice-spinner" />
                Transcribing…
              </span>
            )}
          </div>
          {voiceState !== "idle" ? (
            <button
              type="button"
              className="btn btn-cancel"
              onClick={cancelRecording}
              title="Cancel recording"
            >
              <X size={15} />
              Cancel
            </button>
          ) : sending ? (
            <button type="button" className="btn input-actions-stop" onClick={() => window.electron.chat.stop()}>
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="chat-send"
              onClick={send}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
