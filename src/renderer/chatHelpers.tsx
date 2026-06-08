import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { Check, Copy, Loader2, SquarePen } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import rehypeHighlight from "rehype-highlight";
import {
  MermaidBlock,
  directiveComponents,
  remarkDirectiveToHast,
} from "./markdownDirectives";
import { rehypeNestedListDetails } from "./rehypeNestedListDetails";

export interface ToolCallDisplay {
  toolName: string;
  payload?: unknown;
}

export interface Message {
  id: string;
  role: string;
  content: string;
  toolCalls?: ToolCallDisplay[];
  timestamp?: number;
  model?: string;
}

export function formatMessageTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** Inline “waiting for first token” state for the assistant bubble. */
export function ReplyingIndicator() {
  return (
    <span className="voice-status">
      <Loader2 size={13} className="voice-spinner" />
      Replying…
    </span>
  );
}

function extractCodeText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractCodeText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return extractCodeText(props.children);
  }
  return "";
}

/**
 * Renders assistant/user markdown.
 *
 * Headers h1-h6 are intentionally squashed to paragraphs so the model can't
 * accidentally blow up the type scale; section structure is signalled instead
 * via the custom layout directives in `markdownDirectives.tsx`.
 *
 * We also intercept ```mermaid fenced blocks at the `<pre>` level and route them
 * to a lazy-loaded mermaid renderer; everything else flows through highlight.js.
 */
export function MarkdownContent({
  content,
  collapsibleNestedLists = false,
}: {
  content: string;
  collapsibleNestedLists?: boolean;
}) {
  const headingAsParagraph = ({ children, ...props }: { children?: ReactNode }) => (
    <p {...props}>{children}</p>
  );
  const preComponent = ({ children, ...rest }: { children?: ReactNode }) => {
    const kids = Children.toArray(children);
    const first = kids[0];
    if (isValidElement(first)) {
      const codeEl = first as ReactElement<{ className?: string; children?: ReactNode }>;
      const cls = codeEl.props.className ?? "";
      if (typeof cls === "string" && /\blanguage-mermaid\b/.test(cls)) {
        return <MermaidBlock source={extractCodeText(codeEl.props.children)} />;
      }
    }
    return <pre {...rest}>{children}</pre>;
  };

  const components = {
    h1: headingAsParagraph,
    h2: headingAsParagraph,
    h3: headingAsParagraph,
    h4: headingAsParagraph,
    h5: headingAsParagraph,
    h6: headingAsParagraph,
    pre: preComponent,
    ...directiveComponents,
  } as unknown as Components;

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkDirective, remarkDirectiveToHast]}
      rehypePlugins={[
        [rehypeHighlight, { detect: false, ignoreMissing: true }],
        ...(collapsibleNestedLists ? [rehypeNestedListDetails] : []),
      ]}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
}

/** Minimum tool rows before the card collapses into a summary (inclusive). */
export const TOOL_CALLS_COMPRESS_THRESHOLD = 2;

export function isToolCallPending(call: ToolCallDisplay): boolean {
  const p = call.payload as { pending?: boolean } | undefined;
  return !!p?.pending;
}

/** Short summary for a collapsed multi-tool card, e.g. "Listed notes (3), Read note". */
export function summarizeToolCalls(calls: ToolCallDisplay[]): string {
  if (calls.length === 0) return "";
  const counts = new Map<string, number>();
  for (const call of calls) {
    counts.set(call.toolName, (counts.get(call.toolName) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([name, count]) =>
    count > 1 ? `${toolLabel(name)} (${count})` : toolLabel(name)
  );
  if (parts.length <= 4) return parts.join(", ");
  return `${calls.length} actions`;
}

export function toolLabel(name: string): string {
  const labels: Record<string, string> = {
    task_list: "Reviewed tasks",
    task_create: "Created task",
    task_update: "Updated task",
    task_delete: "Deleted task",
    task_clear_completed: "Cleared completed",
    memory_set_fact: "Updated context",
    memory_list_facts: "Listed context",
    memory_search_conversations: "Searched history",
    get_datetime: "Checked date & time",
    note_list: "Listed notes",
    note_create: "Created note",
    note_read: "Read note",
    note_save: "Saved note",
    note_delete: "Deleted note",
    get_theme: "Read theme",
    update_theme: "Updated theme",
    apply_theme_preset: "Applied theme preset",
    set_layout: "Updated layout",
  };
  return labels[name] ?? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function toolIcon() {
  return <Check size={12} aria-hidden />;
}

export function CopyButton({
  content,
  messageId,
  copiedId,
  onCopied,
}: {
  content: string;
  messageId: string;
  copiedId: string | null;
  onCopied: (id: string | null) => void;
}) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      onCopied(messageId);
      setTimeout(() => onCopied(null), 2000);
    } catch (_) {
      /* ignore */
    }
  };
  const justCopied = copiedId === messageId;
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

export function SaveToNotesButton({
  content,
  messageId,
  savedNoteId,
  onSaveToNotes,
}: {
  content: string;
  messageId: string;
  savedNoteId: string | null;
  onSaveToNotes: (messageId: string, content: string) => void | Promise<void>;
}) {
  const justSaved = savedNoteId === messageId;
  return (
    <button
      type="button"
      className="message-footer-icon-btn"
      onClick={() => void onSaveToNotes(messageId, content)}
      disabled={!content.trim()}
      title={justSaved ? "Added to editor" : "Add to editor"}
      aria-label={justSaved ? "Added to editor" : "Add message to editor"}
    >
      {justSaved ? <Check size={12} /> : <SquarePen size={12} />}
    </button>
  );
}

export const SCROLL_TOP_THRESHOLD = 24;

export type VoiceState = "idle" | "recording" | "processing";
