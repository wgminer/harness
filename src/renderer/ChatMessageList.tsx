import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import {
  type Message,
  type ToolCallDisplay,
  MarkdownContent,
  CopyButton,
  toolLabel,
  toolIcon,
  formatMessageTime,
} from "./chatHelpers";

interface ChatMessageListProps {
  displayMessages: Message[];
  copiedIndex: number | null;
  onCopied: (i: number | null) => void;
  streamingContent: string;
  sending: boolean;
  polishHintAfterDictation: boolean;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onPolish: () => void;
  onGenerateReply: () => void;
}

export function ChatMessageList({
  displayMessages,
  copiedIndex,
  onCopied,
  streamingContent,
  sending,
  polishHintAfterDictation,
  onToolConfirm,
  onPolish,
  onGenerateReply,
}: ChatMessageListProps) {
  const [expandedUserCards, setExpandedUserCards] = useState<Set<number>>(new Set());
  const [overflowedUserCards, setOverflowedUserCards] = useState<Set<number>>(new Set());
  const userCardContentRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const toggleUserCardExpanded = useCallback((index: number) => {
    setExpandedUserCards((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

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

  const showReplyActions =
    displayMessages.length > 0 &&
    displayMessages[displayMessages.length - 1].role === "user" &&
    !streamingContent;
  const showPolishInStrip = showReplyActions && polishHintAfterDictation;

  const n = displayMessages.length;

  return (
    <>
      <div className="chat-messages-stack">
        {displayMessages
          .slice()
          .reverse()
          .map((m, ri) => {
            const i = n - 1 - ri;
            const isAssistant = m.role === "assistant";
            const hasToolCalls = isAssistant && m.toolCalls && m.toolCalls.length > 0;

            return (
              <div
                key={i}
                className={`message-block ${m.role}`}
                data-message-role={m.role}
                data-message-ts={m.timestamp != null ? String(m.timestamp) : undefined}
              >
                <div className="content">
                  {m.role === "user" ? (
                    <div
                      className={`message-user-card${expandedUserCards.has(i) ? " message-user-card--expanded" : ""}${
                        overflowedUserCards.has(i) && !expandedUserCards.has(i)
                          ? " message-user-card--overlay-toggle"
                          : ""
                      }`}
                    >
                      {overflowedUserCards.has(i) && !expandedUserCards.has(i) ? (
                        <div className="message-user-card__fade" aria-hidden />
                      ) : null}
                      <div className="message-user-card__content" ref={(el) => { userCardContentRefs.current[i] = el; }}>
                        {m.content ? <MarkdownContent content={m.content} /> : null}
                      </div>
                      {(expandedUserCards.has(i) || overflowedUserCards.has(i)) && (
                        <button
                          type="button"
                          className={`message-user-card__toggle${
                            expandedUserCards.has(i) ? " message-user-card__toggle--less" : ""
                          }`}
                          onClick={() => toggleUserCardExpanded(i)}
                          aria-expanded={expandedUserCards.has(i)}
                          aria-label={expandedUserCards.has(i) ? undefined : "Show more"}
                          title={expandedUserCards.has(i) ? undefined : "Show more"}
                        >
                          {expandedUserCards.has(i) ? (
                            <>
                              <ChevronUp strokeWidth={2} size={18} aria-hidden />
                              <span className="message-user-card__toggle-text">Close</span>
                            </>
                          ) : (
                            <ChevronDown strokeWidth={2} size={18} aria-hidden />
                          )}
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
                            return (
                              <div key={j} className="tool-card-row">
                                <span className="tool-card-icon">{toolIcon()}</span>
                                <div className="tool-card-row-text">
                                  <span className="tool-card-label">{toolLabel(call.toolName)}</span>
                                </div>
                                {isPending && (
                                  <span className="tool-card-actions">
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => onToolConfirm(call, "proceed")}
                                    >
                                      Proceed
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-sm"
                                      onClick={() => onToolConfirm(call, "cancel")}
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
                    onCopied={onCopied}
                  />
                </div>
              </div>
            );
          })}
      </div>
      {showReplyActions && (
        <div className="chat-secondary-actions">
          {sending ? (
            <span className="voice-status">
              <Loader2 size={13} className="voice-spinner" />
              Replying…
            </span>
          ) : (
            <>
              {showPolishInStrip && (
                <button type="button" className="btn btn-chat-secondary" onClick={onPolish}>
                  Polish
                </button>
              )}
              <button type="button" className="btn btn-chat-secondary" onClick={onGenerateReply}>
                Reply
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
