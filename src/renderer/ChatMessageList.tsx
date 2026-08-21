import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { stripSentAtPrefix } from "../shared/chatTemporalContext";
import {
  type Message,
  type ToolCallDisplay,
  MarkdownContent,
  CopyButton,
  SaveToNotesButton,
  formatMessageTime,
  getInlineWriteup,
  isAttachedNoteCreate,
  type LiveNoteStream,
} from "./chatHelpers";
import { InlineWriteupCard } from "./DocumentCard";
import { ToolCallsCard } from "./ToolCallsCard";
import { StreamingAssistantContent } from "./StreamingAssistantContent";

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
  /** Reply-strip controls while awaiting a reply (suggested prompts or mode picker). */
  replyModeControl?: ReactNode;
  onOptionSelect?: (label: string) => void | Promise<void>;
  liveNoteStream?: LiveNoteStream | null;
  onOpenNoteInEditor?: (noteId: string) => void;
  /** When true, secondary actions are rendered by the parent (bottom dock). */
  dockSecondaryActions?: boolean;
}

interface ChatMessageRowProps {
  message: Message;
  copiedId: string | null;
  savedToNotesId: string | null;
  onCopied: (id: string | null) => void;
  onSaveToNotes: (id: string, content: string, messageTimestamp?: number) => void | Promise<void>;
  /** Latest assistant message while a reply is streaming. */
  isStreamingText: boolean;
  /** Live buffer for the streaming row; empty for every other row. */
  streamingText: string;
  isStreamingWriteup: boolean;
  /** Only supplied to the row that owns the live note stream; null elsewhere. */
  liveNoteStream: LiveNoteStream | null;
  optionsInteractive: boolean;
  onOptionSelect?: (label: string) => void | Promise<void>;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onOpenNoteInEditor?: (noteId: string) => void;
  userExpanded: boolean;
  userOverflowed: boolean;
  toolExpanded: boolean;
  noteBodyCache: Record<string, string>;
  onExpandUserCard: (messageId: string) => void;
  onToggleToolCard: (messageId: string) => void;
  onNoteBodyLoaded: (noteId: string, body: string) => void;
  registerUserCardRef: (messageId: string, el: HTMLDivElement | null) => void;
}

/**
 * One transcript row. Memoized because a streaming reply re-renders the list on
 * every flush; without this every mounted message re-runs its markdown parse.
 */
const ChatMessageRow = memo(function ChatMessageRow({
  message: m,
  copiedId,
  savedToNotesId,
  onCopied,
  onSaveToNotes,
  isStreamingText,
  streamingText,
  isStreamingWriteup,
  liveNoteStream,
  optionsInteractive,
  onOptionSelect,
  onToolConfirm,
  onOpenNoteInEditor,
  userExpanded,
  userOverflowed,
  toolExpanded,
  noteBodyCache,
  onExpandUserCard,
  onToggleToolCard,
  onNoteBodyLoaded,
  registerUserCardRef,
}: ChatMessageRowProps) {
  const isAssistant = m.role === "assistant";
  const inlineWriteup = useMemo(
    () => (isAssistant ? getInlineWriteup(m.toolCalls) : null),
    [isAssistant, m.toolCalls],
  );

  // Dedup ran inside the render loop with a nested findIndex (O(n^2) per row).
  const visibleToolCalls = useMemo(() => {
    if (!isAssistant || !m.toolCalls || m.toolCalls.length === 0) return null;
    let seenAttachedNoteCreate = false;
    let seenLongResponse = false;
    const kept: ToolCallDisplay[] = [];
    for (const tc of m.toolCalls) {
      if (isAttachedNoteCreate(tc)) {
        if (seenAttachedNoteCreate) continue;
        seenAttachedNoteCreate = true;
      } else if (tc.toolName === "open_long_response") {
        if (seenLongResponse) continue;
        seenLongResponse = true;
      }
      kept.push(tc);
    }
    return kept;
  }, [isAssistant, m.toolCalls]);

  const setUserCardRef = useCallback(
    (el: HTMLDivElement | null) => registerUserCardRef(m.id, el),
    [registerUserCardRef, m.id],
  );
  const handleExpandUserCard = useCallback(
    () => onExpandUserCard(m.id),
    [onExpandUserCard, m.id],
  );
  const handleToggleToolCard = useCallback(
    () => onToggleToolCard(m.id),
    [onToggleToolCard, m.id],
  );

  // While streaming, live text is held outside `messages`; fall back to the
  // stored content once the buffer has been committed at stream end.
  const bodyText = isStreamingText ? streamingText || m.content : m.content;
  const cachedNoteBody =
    inlineWriteup?.noteId != null ? noteBodyCache[inlineWriteup.noteId] : undefined;
  const liveWriteupBody =
    isStreamingWriteup && liveNoteStream ? liveNoteStream.body : undefined;
  const saveCopyContent =
    liveWriteupBody || inlineWriteup?.body || cachedNoteBody || bodyText;
  const hideSaveToNotes = !!inlineWriteup?.noteId && !inlineWriteup.body;
  const showOverlayToggle = userOverflowed && !userExpanded;

  let assistantBubbleBody: ReactNode = null;
  if (m.role !== "user") {
    if (isStreamingText) {
      assistantBubbleBody = (
        <StreamingAssistantContent
          content={bodyText}
          isStreaming
          messageId={m.id}
          messageTimestamp={m.timestamp}
          copiedId={copiedId}
          savedToNotesId={savedToNotesId}
          onCopied={onCopied}
          onSaveToNotes={onSaveToNotes}
          onOptionSelect={optionsInteractive ? onOptionSelect : undefined}
        />
      );
    } else if (m.content) {
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
    }
  }

  return (
    <div
      className={`message-block ${m.role}`}
      data-message-role={m.role}
      data-message-ts={m.timestamp != null ? String(m.timestamp) : undefined}
      data-message-id={m.id}
    >
      <div className="content">
        {m.role === "user" ? (
          <div
            className={`message-user-card${userExpanded ? " message-user-card--expanded" : ""}${
              showOverlayToggle ? " message-user-card--overlay-toggle" : ""
            }`}
          >
            {showOverlayToggle ? (
              <div className="message-user-card__fade" aria-hidden />
            ) : null}
            <div className="message-user-card__content" ref={setUserCardRef}>
              {m.content ? (
                <MarkdownContent
                  content={m.content}
                  messageId={m.id}
                  messageTimestamp={m.timestamp}
                  copiedId={copiedId}
                  savedToNotesId={savedToNotesId}
                  onCopied={onCopied}
                  onSaveToNotes={onSaveToNotes}
                />
              ) : null}
            </div>
            {showOverlayToggle && (
              <button
                type="button"
                className="message-user-card__toggle"
                onClick={handleExpandUserCard}
                aria-expanded={false}
                aria-label="Show more"
                title="Show more"
              >
                <ChevronDown strokeWidth={2} size={16} aria-hidden />
              </button>
            )}
          </div>
        ) : (
          <>
            {visibleToolCalls && (
              <ToolCallsCard
                toolCalls={visibleToolCalls}
                expanded={toolExpanded}
                onToggleExpanded={handleToggleToolCard}
                onToolConfirm={onToolConfirm}
                onOpenNote={onOpenNoteInEditor}
              />
            )}
            {assistantBubbleBody}
            {inlineWriteup && (
              <InlineWriteupCard
                writeup={inlineWriteup}
                liveStream={liveNoteStream}
                streaming={isStreamingWriteup}
                onOpenInEditor={onOpenNoteInEditor}
                onBodyLoaded={onNoteBodyLoaded}
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
              {isStreamingText ? (
                <Loader2
                  size={12}
                  className="voice-spinner message-block-meta-spinner"
                  aria-label="Streaming reply"
                />
              ) : null}
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
});

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
  replyModeControl,
  onOptionSelect,
  liveNoteStream,
  onOpenNoteInEditor,
  dockSecondaryActions = false,
}: ChatMessageListProps) {
  const [expandedUserCards, setExpandedUserCards] = useState<Set<string>>(new Set());
  const [expandedToolCards, setExpandedToolCards] = useState<Set<string>>(new Set());
  const [overflowedUserCards, setOverflowedUserCards] = useState<Set<string>>(new Set());
  const [noteBodyCache, setNoteBodyCache] = useState<Record<string, string>>({});
  const userCardContentRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const expandUserCard = useCallback((messageId: string) => {
    setExpandedUserCards((prev) => {
      if (prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.add(messageId);
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

  const registerUserCardRef = useCallback((messageId: string, el: HTMLDivElement | null) => {
    userCardContentRefs.current[messageId] = el;
  }, []);

  /**
   * Overflow measurement forces layout, so it must not be keyed on
   * `displayMessages` — that changes on every streamed flush. Only user-card
   * content can overflow, so key on just those messages.
   */
  const userCardSignature = useMemo(
    () =>
      displayMessages
        .filter((m) => m.role === "user")
        .map((m) => `${m.id}:${m.content.length}`)
        .join("|"),
    [displayMessages],
  );

  useLayoutEffect(() => {
    const next = new Set<string>();
    for (const [id, el] of Object.entries(userCardContentRefs.current)) {
      if (!el) continue;
      if (expandedUserCards.has(id)) continue;
      if (el.scrollHeight > el.clientHeight) next.add(id);
    }
    setOverflowedUserCards((prev) =>
      prev.size !== next.size || [...prev].some((id) => !next.has(id)) ? next : prev
    );
  }, [userCardSignature, expandedUserCards]);

  const lastMessage = displayMessages[displayMessages.length - 1];
  const showReplyActions =
    displayMessages.length > 0 && lastMessage?.role === "user" && !streamingContent;
  const optionSelectEnabled =
    !!onOptionSelect && llmActionsEnabled && !sending && !streamingContent;
  const showPolishInStrip = showReplyActions && polishHintAfterDictation;
  const showStripModes = showReplyActions && !!replyModeControl;
  const showSecondaryActions =
    !dockSecondaryActions && (showPolishInStrip || showStripModes);
  return (
    <>
      <div className="chat-messages-stack">
        {displayMessages.map((m, idx) => {
          const isAssistant = m.role === "assistant";
          const isLatestAssistant = isAssistant && idx === displayMessages.length - 1;
          const isStreamingWriteup = sending && !!liveNoteStream && isLatestAssistant;
          const isStreamingText = isLatestAssistant && sending;
          return (
            <ChatMessageRow
              key={m.id}
              message={m}
              copiedId={copiedId}
              savedToNotesId={savedToNotesId}
              onCopied={onCopied}
              onSaveToNotes={onSaveToNotes}
              isStreamingText={isStreamingText}
              streamingText={isStreamingText ? streamingContent : ""}
              isStreamingWriteup={isStreamingWriteup}
              liveNoteStream={isStreamingWriteup ? liveNoteStream ?? null : null}
              optionsInteractive={
                optionSelectEnabled && isAssistant && lastMessage?.id === m.id
              }
              onOptionSelect={onOptionSelect}
              onToolConfirm={onToolConfirm}
              onOpenNoteInEditor={onOpenNoteInEditor}
              userExpanded={expandedUserCards.has(m.id)}
              userOverflowed={overflowedUserCards.has(m.id)}
              toolExpanded={expandedToolCards.has(m.id)}
              noteBodyCache={noteBodyCache}
              onExpandUserCard={expandUserCard}
              onToggleToolCard={toggleToolCardExpanded}
              onNoteBodyLoaded={handleNoteBodyLoaded}
              registerUserCardRef={registerUserCardRef}
            />
          );
        })}
      </div>
      {showSecondaryActions && (
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
          {showStripModes ? replyModeControl : null}
        </div>
      )}
    </>
  );
}
