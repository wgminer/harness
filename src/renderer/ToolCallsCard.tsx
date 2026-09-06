import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, Image as ImageIcon, MessageCircle, Mic, StickyNote } from "lucide-react";
import {
  type ToolCallDisplay,
  TOOL_CALLS_COMPRESS_THRESHOLD,
  isToolCallPending,
  memorySearchHitsFromToolCall,
  noteIdFromCreateToolCall,
  summarizeToolCalls,
  toolCallLabel,
  toolIcon,
  type MemorySearchHit,
} from "./chatHelpers";

interface ToolCallsCardProps {
  toolCalls: ToolCallDisplay[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onOpenNote?: (noteId: string) => void;
  onOpenConversation?: (conversationId: string) => void;
  onOpenImage?: (imageId: string) => void;
}

function ToolCardSummaryRow({
  label,
  chevron,
  onClick,
  ariaExpanded,
  ariaLabel,
}: {
  label: string;
  chevron: ReactNode;
  onClick: () => void;
  ariaExpanded: boolean;
  ariaLabel: string;
}) {
  return (
    <div className="tool-card-row">
      <span className="tool-card-icon">{toolIcon()}</span>
      <button
        type="button"
        className="tool-card-summary-toggle"
        onClick={onClick}
        aria-expanded={ariaExpanded}
        aria-label={ariaLabel}
      >
        <span className="tool-card-label">{label}</span>
        {chevron}
      </button>
    </div>
  );
}

function searchHitKindLabel(kind: MemorySearchHit["kind"]): string {
  switch (kind) {
    case "dictation":
      return "Dictation";
    case "note":
      return "Note";
    case "image":
      return "Image";
    default:
      return "Chat";
  }
}

function searchHitIcon(kind: MemorySearchHit["kind"]) {
  switch (kind) {
    case "dictation":
      return <Mic size={18} aria-hidden />;
    case "note":
      return <StickyNote size={18} aria-hidden />;
    case "image":
      return <ImageIcon size={18} aria-hidden />;
    default:
      return <MessageCircle size={18} aria-hidden />;
  }
}

function MemorySearchHitsList({
  hits,
  onOpenConversation,
  onOpenNote,
  onOpenImage,
}: {
  hits: MemorySearchHit[];
  onOpenConversation?: (conversationId: string) => void;
  onOpenNote?: (noteId: string) => void;
  onOpenImage?: (imageId: string) => void;
}) {
  if (hits.length === 0) {
    return <div className="tool-card-search-empty">No matching chats, notes, or images.</div>;
  }

  return (
    <ul className="tool-card-search-list">
      {hits.map((hit) => {
        const snippet = hit.excerpts?.[0] ?? hit.snippet ?? "";
        const kindLabel = searchHitKindLabel(hit.kind);
        const meta = snippet ? `${kindLabel} · ${snippet}` : kindLabel;
        const canOpenConversation =
          (hit.kind === "chat" || hit.kind === "dictation") && !!onOpenConversation;
        const canOpenNote = hit.kind === "note" && !!onOpenNote;
        const canOpenImage = hit.kind === "image" && !!onOpenImage;
        const clickable = canOpenConversation || canOpenNote || canOpenImage;

        const open = () => {
          if (canOpenConversation) onOpenConversation!(hit.id);
          else if (canOpenNote) onOpenNote!(hit.id);
          else if (canOpenImage) onOpenImage!(hit.id);
        };

        const body = (
          <>
            <span className="tool-card-search-item__icon">{searchHitIcon(hit.kind)}</span>
            <span className="tool-card-search-item__body">
              <span className="tool-card-search-item__title">{hit.title}</span>
              <span className="tool-card-search-item__meta">{meta}</span>
            </span>
          </>
        );

        return (
          <li key={`${hit.kind}-${hit.id}`}>
            {clickable ? (
              <button type="button" className="tool-card-search-item" onClick={open}>
                {body}
              </button>
            ) : (
              <div className="tool-card-search-item tool-card-search-item--static">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ToolCallRow({
  call,
  onToolConfirm,
  onOpenNote,
  onOpenConversation,
  onOpenImage,
}: {
  call: ToolCallDisplay;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onOpenNote?: (noteId: string) => void;
  onOpenConversation?: (conversationId: string) => void;
  onOpenImage?: (imageId: string) => void;
}) {
  const isPending = isToolCallPending(call);
  const isResolving =
    isPending &&
    !!(call.payload as { resolving?: boolean } | undefined)?.resolving;
  const noteId = !isPending ? noteIdFromCreateToolCall(call) : null;
  const canOpenNote = !!noteId && !!onOpenNote;
  const searchHits =
    call.toolName === "memory_search_conversations" ? memorySearchHitsFromToolCall(call) : [];

  if (searchHits.length > 0) {
    return (
      <div className="tool-card-row tool-card-row--search">
        <div className="tool-card-search-header">
          <span className="tool-card-icon">{toolIcon()}</span>
          <span className="tool-card-label">{toolCallLabel(call)}</span>
        </div>
        <MemorySearchHitsList
          hits={searchHits}
          onOpenConversation={onOpenConversation}
          onOpenNote={onOpenNote}
          onOpenImage={onOpenImage}
        />
      </div>
    );
  }

  const label = toolCallLabel(call);
  const pendingPayload = isPending
    ? (call.payload as { preview?: string; path?: string } | undefined)
    : undefined;
  const preview =
    typeof pendingPayload?.preview === "string" ? pendingPayload.preview : null;

  return (
    <div className={`tool-card-row${preview ? " tool-card-row--preview" : ""}`}>
      <span className="tool-card-icon">{toolIcon()}</span>
      <div className="tool-card-row-text">
        {canOpenNote ? (
          <button
            type="button"
            className="tool-card-note-link"
            onClick={() => onOpenNote!(noteId!)}
            title="Open note"
          >
            {label}
          </button>
        ) : (
          <span className="tool-card-label">
            {label}
            {pendingPayload?.path ? ` · ${pendingPayload.path}` : ""}
          </span>
        )}
        {preview ? <pre className="tool-card-preview">{preview}</pre> : null}
      </div>
      {isPending && (
        <span className="tool-card-actions">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onToolConfirm(call, "proceed")}
            disabled={isResolving}
          >
            {isResolving ? "Working…" : "Proceed"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onToolConfirm(call, "cancel")}
            disabled={isResolving}
          >
            Cancel
          </button>
        </span>
      )}
    </div>
  );
}

export function ToolCallsCard({
  toolCalls,
  expanded,
  onToggleExpanded,
  onToolConfirm,
  onOpenNote,
  onOpenConversation,
  onOpenImage,
}: ToolCallsCardProps) {
  const hasPending = toolCalls.some(isToolCallPending);
  const canCompress = toolCalls.length >= TOOL_CALLS_COMPRESS_THRESHOLD;
  const compressed = canCompress && !expanded && !hasPending;
  const hasSearchHits = toolCalls.some(
    (call) =>
      call.toolName === "memory_search_conversations" &&
      memorySearchHitsFromToolCall(call).length > 0,
  );

  if (compressed) {
    const summary = summarizeToolCalls(toolCalls);
    return (
      <div className="tool-card tool-card--compressed">
        <ToolCardSummaryRow
          label={summary}
          chevron={<ChevronDown strokeWidth={2} size={16} aria-hidden />}
          onClick={onToggleExpanded}
          ariaExpanded={false}
          ariaLabel={`Show ${toolCalls.length} tool actions: ${summary}`}
        />
      </div>
    );
  }

  return (
    <div
      className={`tool-card${canCompress ? " tool-card--expandable" : ""}${
        hasSearchHits ? " tool-card--search" : ""
      }`}
    >
      {canCompress && (
        <ToolCardSummaryRow
          label="Hide"
          chevron={<ChevronUp strokeWidth={2} size={16} aria-hidden />}
          onClick={onToggleExpanded}
          ariaExpanded
          ariaLabel="Hide tool actions"
        />
      )}
      {toolCalls.map((call, j) => (
        <ToolCallRow
          key={j}
          call={call}
          onToolConfirm={onToolConfirm}
          onOpenNote={onOpenNote}
          onOpenConversation={onOpenConversation}
          onOpenImage={onOpenImage}
        />
      ))}
    </div>
  );
}
