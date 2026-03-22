import { useState, useEffect, useRef, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface ToolCallDisplay {
  toolName: string;
  payload?: unknown;
}

interface Message {
  role: string;
  content: string;
  toolCalls?: ToolCallDisplay[];
  timestamp?: number;
}

function formatMessageTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

interface ChatViewProps {
  conversationId: string | null;
  onConversationCreated: () => void;
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
  };
  return labels[name] ?? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
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

export function ChatView({ conversationId, onConversationCreated }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [sending, setSending] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  /** Tool calls for the assistant turn currently being streamed; shown inline and then stored on the message when stream ends. */
  const [currentTurnToolCalls, setCurrentTurnToolCalls] = useState<ToolCallDisplay[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamingContentRef = useRef("");
  const currentTurnToolCallsRef = useRef<ToolCallDisplay[]>([]);

  useEffect(() => {
    streamingContentRef.current = streamingContent;
  }, [streamingContent]);
  useEffect(() => {
    currentTurnToolCallsRef.current = currentTurnToolCalls;
  }, [currentTurnToolCalls]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    window.electron.memory.getMessages(conversationId).then((list) =>
      setMessages(list.map((m) => ({ role: m.role, content: m.content, toolCalls: (m as Message).toolCalls })))
    );
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
          },
        ]
      : messages;

  useEffect(() => {
    const unsubChunk = window.electron.chat.onStreamChunk((cid, chunk) => {
      if (cid === conversationId) setStreamingContent((prev) => prev + chunk);
    });
    const unsubEnd = window.electron.chat.onStreamEnd((cid) => {
      if (cid === conversationId) {
        const finalContent = streamingContentRef.current;
        const toolCalls = currentTurnToolCallsRef.current.length > 0 ? [...currentTurnToolCallsRef.current] : undefined;
        setMessages((prev) =>
          finalContent || toolCalls
            ? [...prev, { role: "assistant", content: finalContent || "", toolCalls }]
            : prev
        );
        setStreamingContent("");
        setCurrentTurnToolCalls([]);
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

  const onChatAreaScroll = useCallback(() => {
    const el = chatAreaRef.current;
    setHasScrolled(!!el && el.scrollTop > SCROLL_TOP_THRESHOLD);
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

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !conversationId || sending) return;
    setInput("");
    setSending(true);
    setStreamingContent("");
    setCurrentTurnToolCalls([]);
    // Optimistically show user message immediately
    setMessages((prev) => [...prev, { role: "user", content: text, timestamp: Date.now() }]);
    try {
      await window.electron.chat.send(conversationId, text);
      onConversationCreated();
    } catch (e) {
      setStreamingContent(`[Error: ${e instanceof Error ? e.message : String(e)}]`);
      setSending(false);
    }
  }, [input, conversationId, sending, onConversationCreated]);

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
    >
      <div className="chat-area">
        <div className="chat-area-inner">
          {displayMessages.map((m, i) => {
            const isAssistant = m.role === "assistant";
            const hasToolCalls = isAssistant && m.toolCalls && m.toolCalls.length > 0;

            return (
              <div key={i} className={`message-block ${m.role}`}>
                <div className="content">
                  {m.role === "user" ? (
                    <div className="message-user-card">
                      <div className="message-user-card__content">
                        {m.content ? <MarkdownContent content={m.content} /> : null}
                      </div>
                    </div>
                  ) : (
                    <>
                      {hasToolCalls && (
                        <div className="tool-card">
                          {m.toolCalls!.map((call, j) => {
                            const p = call.payload as { pending?: boolean } | undefined;
                            const isPending = !!p?.pending;
                            return (
                              <div key={j} className="tool-card-row">
                                <span className="tool-card-label">{toolLabel(call.toolName)}</span>
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
                {/* {isAssistant && (
                  <div className="message-block-footer">
                    <CopyButton
                      content={m.content}
                      messageIndex={i}
                      copiedIndex={copiedIndex}
                      onCopied={setCopiedIndex}
                    />
                  </div>
                )} */}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>
      <div className="input-container input-container--sticky">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Type a message..."
          disabled={sending}
          rows={1}
        />
        <div className="input-actions">
          <button type="button" className="btn btn-primary" onClick={send} disabled={sending || !input.trim()}>
            Send
          </button>
          {sending && (
            <button type="button" className="btn input-actions-stop" onClick={() => window.electron.chat.stop()}>
              Stop
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
