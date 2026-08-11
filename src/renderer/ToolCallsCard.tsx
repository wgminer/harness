import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  type ToolCallDisplay,
  TOOL_CALLS_COMPRESS_THRESHOLD,
  isToolCallPending,
  noteIdFromCreateToolCall,
  summarizeToolCalls,
  toolCallLabel,
  toolIcon,
} from "./chatHelpers";

interface ToolCallsCardProps {
  toolCalls: ToolCallDisplay[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onOpenNote?: (noteId: string) => void;
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

function ToolCallRow({
  call,
  onToolConfirm,
  onOpenNote,
}: {
  call: ToolCallDisplay;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
  onOpenNote?: (noteId: string) => void;
}) {
  const isPending = isToolCallPending(call);
  const noteId = !isPending ? noteIdFromCreateToolCall(call) : null;
  const canOpenNote = !!noteId && !!onOpenNote;
  const label = toolCallLabel(call);

  return (
    <div className="tool-card-row">
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
          <span className="tool-card-label">{label}</span>
        )}
      </div>
      {isPending && (
        <span className="tool-card-actions">
          <button type="button" className="btn btn-sm btn-primary" onClick={() => onToolConfirm(call, "proceed")}>
            Proceed
          </button>
          <button type="button" className="btn btn-sm" onClick={() => onToolConfirm(call, "cancel")}>
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
}: ToolCallsCardProps) {
  const hasPending = toolCalls.some(isToolCallPending);
  const canCompress = toolCalls.length >= TOOL_CALLS_COMPRESS_THRESHOLD;
  const compressed = canCompress && !expanded && !hasPending;

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
    <div className={`tool-card${canCompress ? " tool-card--expandable" : ""}`}>
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
        <ToolCallRow key={j} call={call} onToolConfirm={onToolConfirm} onOpenNote={onOpenNote} />
      ))}
    </div>
  );
}
