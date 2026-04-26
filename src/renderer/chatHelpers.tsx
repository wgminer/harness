import { Check, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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

/** Renders markdown (bold, lists, code, etc.) without headers (they render as paragraphs). */
export function MarkdownContent({ content }: { content: string }) {
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

export function toolLabel(name: string): string {
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
    doc_read: "Read writing surface",
    doc_write: "Rewrote writing surface",
    doc_append: "Appended to writing surface",
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

export const SCROLL_TOP_THRESHOLD = 24;

export type VoiceState = "idle" | "recording" | "processing";
