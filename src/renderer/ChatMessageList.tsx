import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  type Message,
  type ToolCallDisplay,
  MarkdownContent,
  CopyButton,
  toolLabel,
  toolIcon,
  formatMessageTime,
  ReplyingIndicator,
} from "./chatHelpers";

interface ChatMessageListProps {
  displayMessages: Message[];
  copiedId: string | null;
  onCopied: (id: string | null) => void;
  streamingContent: string;
  sending: boolean;
  polishHintAfterDictation: boolean;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onPolish: () => void;
  onGenerateReply: () => void;
}

export function ChatMessageList({
  displayMessages,
  copiedId,
  onCopied,
  streamingContent,
  sending,
  polishHintAfterDictation,
  onToolConfirm,
  onPolish,
  onGenerateReply,
}: ChatMessageListProps) {
  const [expandedUserCards, setExpandedUserCards] = useState<Set<string>>(new Set());
  const [overflowedUserCards, setOverflowedUserCards] = useState<Set<string>>(new Set());
  const userCardContentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggleUserCardExpanded = useCallback((messageId: string) => {
    setExpandedUserCards((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const next = new Set<string>();
    displayMessages.forEach((m) => {
      if (m.role !== "user") return;
      if (expandedUserCards.has(m.id)) return;
      const el = userCardContentRefs.current[m.id];
      if (el && el.scrollHeight > el.clientHeight) next.add(m.id);
    });
    setOverflowedUserCards((prev) =>
      prev.size !== next.size || [...prev].some((id) => !next.has(id)) ? next : prev
    );
  }, [displayMessages, expandedUserCards]);

  const showReplyActions =
    displayMessages.length > 0 &&
    displayMessages[displayMessages.length - 1].role === "user" &&
    !streamingContent;
  const showPolishInStrip = showReplyActions && polishHintAfterDictation;

  return (
    <>
      <div className="chat-messages-stack">
        {displayMessages.map((m, idx) => {
          const isAssistant = m.role === "assistant";
          const hasToolCalls = isAssistant && m.toolCalls && m.toolCalls.length > 0;
          const isLatestAssistantPending =
            sending &&
            isAssistant &&
            idx === displayMessages.length - 1 &&
            !m.content &&
            !streamingContent;

          let assistantBubbleBody: ReactNode = null;
          if (m.role !== "user") {
            if (m.content) assistantBubbleBody = <MarkdownContent content={m.content} />;
            else if (isLatestAssistantPending) assistantBubbleBody = <ReplyingIndicator />;
          }

          return (
            <div
              key={m.id}
              className={`message-block ${m.role}`}
              data-message-role={m.role}
              data-message-ts={m.timestamp != null ? String(m.timestamp) : undefined}
              data-message-id={m.id}
            >
              <div className="content">
                {m.role === "user" ? (
                  <div
                    className={`message-user-card${expandedUserCards.has(m.id) ? " message-user-card--expanded" : ""}${
                      overflowedUserCards.has(m.id) && !expandedUserCards.has(m.id)
                        ? " message-user-card--overlay-toggle"
                        : ""
                    }`}
                  >
                    {overflowedUserCards.has(m.id) && !expandedUserCards.has(m.id) ? (
                      <div className="message-user-card__fade" aria-hidden />
                    ) : null}
                    <div className="message-user-card__content" ref={(el) => { userCardContentRefs.current[m.id] = el; }}>
                      {m.content ? <MarkdownContent content={m.content} /> : null}
                    </div>
                    {(expandedUserCards.has(m.id) || overflowedUserCards.has(m.id)) && (
                      <button
                        type="button"
                        className={`message-user-card__toggle${
                          expandedUserCards.has(m.id) ? " message-user-card__toggle--less" : ""
                        }`}
                        onClick={() => toggleUserCardExpanded(m.id)}
                        aria-expanded={expandedUserCards.has(m.id)}
                        aria-label={expandedUserCards.has(m.id) ? undefined : "Show more"}
                        title={expandedUserCards.has(m.id) ? undefined : "Show more"}
                      >
                        {expandedUserCards.has(m.id) ? (
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
                    {assistantBubbleBody}
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
                  messageId={m.id}
                  copiedId={copiedId}
                  onCopied={onCopied}
                />
              </div>
            </div>
          );
        })}
      </div>
      {showReplyActions && (
        <div className="chat-secondary-actions">
          {showPolishInStrip && (
            <button type="button" className="btn btn-chat-secondary chat-pane-btn" onClick={onPolish}>
              Polish
            </button>
          )}
          <button type="button" className="btn btn-chat-secondary chat-pane-btn" onClick={onGenerateReply}>
            Reply
          </button>
        </div>
      )}
    </>
  );
}
