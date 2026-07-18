import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { stripSentAtPrefix } from "../shared/chatTemporalContext";
import { resolveDictationReplyLabel } from "../shared/dictationReplyStrip";
import {
  type Message,
  type ToolCallDisplay,
  MarkdownContent,
  CopyButton,
  SaveToNotesButton,
  formatMessageTime,
  ReplyingIndicator,
  getInlineWriteup,
  isAttachedNoteCreate,
  type LiveNoteStream,
} from "./chatHelpers";
import { InlineWriteupCard } from "./DocumentCard";
import { ToolCallsCard } from "./ToolCallsCard";

interface ChatMessageListProps {
  displayMessages: Message[];
  copiedId: string | null;
  savedToNotesId: string | null;
  onCopied: (id: string | null) => void;
  onSaveToNotes: (id: string, content: string, messageTimestamp?: number) => void | Promise<void>;
  streamingContent: string;
  sending: boolean;
  polishHintAfterDictation: boolean;
  llmActionsEnabled?: boolean;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onPolish: () => void;
  onGenerateReply: () => void;
  onOptionSelect?: (label: string) => void | Promise<void>;
  liveNoteStream?: LiveNoteStream | null;
  onOpenNoteInEditor?: (noteId: string) => void;
}

export function ChatMessageList({
  displayMessages,
  copiedId,
  savedToNotesId,
  onCopied,
  onSaveToNotes,
  streamingContent,
  sending,
  polishHintAfterDictation,
  llmActionsEnabled = true,
  onToolConfirm,
  onPolish,
  onGenerateReply,
  onOptionSelect,
  liveNoteStream,
  onOpenNoteInEditor,
}: ChatMessageListProps) {
  const [expandedUserCards, setExpandedUserCards] = useState<Set<string>>(new Set());
  const [expandedToolCards, setExpandedToolCards] = useState<Set<string>>(new Set());
  const [overflowedUserCards, setOverflowedUserCards] = useState<Set<string>>(new Set());
  const [noteBodyCache, setNoteBodyCache] = useState<Record<string, string>>({});
  const userCardContentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const toggleUserCardExpanded = useCallback((messageId: string) => {
    setExpandedUserCards((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }, []);

  const handleNoteBodyLoaded = useCallback((noteId: string, body: string) => {
    setNoteBodyCache((prev) => (prev[noteId] === body ? prev : { ...prev, [noteId]: body }));
  }, []);

  const toggleToolCardExpanded = useCallback((messageId: string) => {
    setExpandedToolCards((prev) => {
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

  const lastMessage = displayMessages[displayMessages.length - 1];
  const showReplyActions =
    displayMessages.length > 0 && lastMessage?.role === "user" && !streamingContent;
  const optionSelectEnabled =
    !!onOptionSelect && llmActionsEnabled && !sending && !streamingContent;
  const showPolishInStrip = showReplyActions && polishHintAfterDictation;
  const replyLabel = resolveDictationReplyLabel();
  return (
    <>
      <div className="chat-messages-stack">
        {displayMessages.map((m, idx) => {
          const isAssistant = m.role === "assistant";
          const hasToolCalls = isAssistant && m.toolCalls && m.toolCalls.length > 0;
          const inlineWriteup = isAssistant ? getInlineWriteup(m.toolCalls) : null;
          const isLatestAssistant = isAssistant && idx === displayMessages.length - 1;
          const isStreamingWriteup =
            sending && !!liveNoteStream && isLatestAssistant;
          const isLatestAssistantPending =
            sending &&
            isAssistant &&
            isLatestAssistant &&
            !m.content &&
            !streamingContent;

          const optionsInteractive =
            optionSelectEnabled && isAssistant && lastMessage?.id === m.id;

          const cachedNoteBody =
            inlineWriteup?.noteId != null ? noteBodyCache[inlineWriteup.noteId] : undefined;
          const liveWriteupBody =
            isStreamingWriteup && liveNoteStream ? liveNoteStream.body : undefined;
          const saveCopyContent =
            liveWriteupBody ||
            inlineWriteup?.body ||
            cachedNoteBody ||
            m.content;
          const hideSaveToNotes = !!inlineWriteup?.noteId && !inlineWriteup.body;

          let assistantBubbleBody: ReactNode = null;
          if (m.role !== "user") {
            if (m.content)
              assistantBubbleBody = (
                <MarkdownContent
                  content={stripSentAtPrefix(m.content)}
                  messageId={m.id}
                  messageTimestamp={m.timestamp}
                  copiedId={copiedId}
                  savedToNotesId={savedToNotesId}
                  onCopied={onCopied}
                  onSaveToNotes={onSaveToNotes}
                  onOptionSelect={optionsInteractive ? onOptionSelect : undefined}
                />
              );
            else if (isLatestAssistantPending) assistantBubbleBody = <ReplyingIndicator />;
          }

          const markdownActions = {
            messageId: m.id,
            messageTimestamp: m.timestamp,
            copiedId,
            savedToNotesId,
            onCopied,
            onSaveToNotes,
          };

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
                      {m.content ? <MarkdownContent content={m.content} {...markdownActions} /> : null}
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
                      <ToolCallsCard
                        toolCalls={
                          m.toolCalls!.filter((tc, i, arr) => {
                            if (isAttachedNoteCreate(tc)) {
                              return (
                                arr.findIndex(
                                  (x) =>
                                    x.toolName === "note_create" && isAttachedNoteCreate(x),
                                ) === i
                              );
                            }
                            if (tc.toolName === "open_long_response") {
                              return (
                                arr.findIndex((x) => x.toolName === "open_long_response") === i
                              );
                            }
                            return true;
                          })
                        }
                        expanded={expandedToolCards.has(m.id)}
                        onToggleExpanded={() => toggleToolCardExpanded(m.id)}
                        onToolConfirm={onToolConfirm}
                      />
                    )}
                    {assistantBubbleBody}
                    {inlineWriteup && (
                      <InlineWriteupCard
                        writeup={inlineWriteup}
                        liveStream={liveNoteStream}
                        streaming={isStreamingWriteup}
                        onOpenInEditor={onOpenNoteInEditor}
                        onBodyLoaded={handleNoteBodyLoaded}
                      />
                    )}
                  </>
                )}
              </div>
              <div className="message-block-footer">
                <div className="message-block-meta">
                  {m.role === "user" ? (
                    <>
                      <span>You</span>
                      {m.timestamp != null ? (
                        <>
                          <span className="message-block-meta-sep" aria-hidden="true">
                            ·
                          </span>
                          <span className="message-block-meta-time">{formatMessageTime(m.timestamp)}</span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="message-block-meta-model">{m.model?.trim() || "Assistant"}</span>
                      {m.timestamp != null ? (
                        <>
                          <span className="message-block-meta-sep" aria-hidden="true">
                            ·
                          </span>
                          <span className="message-block-meta-time">{formatMessageTime(m.timestamp)}</span>
                        </>
                      ) : null}
                    </>
                  )}
                </div>
                <div className="message-block-footer-actions">
                  {!hideSaveToNotes ? (
                    <SaveToNotesButton
                      content={saveCopyContent}
                      messageId={m.id}
                      messageTimestamp={m.timestamp}
                      savedNoteId={savedToNotesId}
                      onSaveToNotes={onSaveToNotes}
                    />
                  ) : null}
                  <CopyButton content={saveCopyContent} messageId={m.id} copiedId={copiedId} onCopied={onCopied} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {showReplyActions && (
        <div className="chat-secondary-actions" data-testid="chat-secondary-actions">
          {showPolishInStrip && (
            <button
              type="button"
              className="btn btn-compact chat-pane-btn"
              onClick={onPolish}
              disabled={!llmActionsEnabled}
            >
              Polish
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline btn-compact chat-pane-btn"
            onClick={onGenerateReply}
            data-testid="chat-generate-reply"
            disabled={!llmActionsEnabled}
          >
            {replyLabel}
          </button>
        </div>
      )}
    </>
  );
}
