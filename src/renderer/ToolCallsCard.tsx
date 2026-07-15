import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
  type ToolCallDisplay,
  TOOL_CALLS_COMPRESS_THRESHOLD,
  isToolCallPending,
  summarizeToolCalls,
  toolCallLabel,
  toolIcon,
} from "./chatHelpers";

interface ToolCallsCardProps {
  toolCalls: ToolCallDisplay[];
  expanded: boolean;
  onToggleExpanded: () => void;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
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
}: {
  call: ToolCallDisplay;
  onToolConfirm: (tc: ToolCallDisplay, action: "proceed" | "cancel") => void;
}) {
  const isPending = isToolCallPending(call);
  return (
    <div className="tool-card-row">
      <span className="tool-card-icon">{toolIcon()}</span>
      <div className="tool-card-row-text">
        <span className="tool-card-label">{toolCallLabel(call)}</span>
      </div>
      {isPending && (
        <span className="tool-card-actions">
          <button type="button" className="btn btn-sm" onClick={() => onToolConfirm(call, "proceed")}>
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

export function ToolCallsCard({ toolCalls, expanded, onToggleExpanded, onToolConfirm }: ToolCallsCardProps) {
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
        <ToolCallRow key={j} call={call} onToolConfirm={onToolConfirm} />
      ))}
    </div>
  );
}
