import {
  Children,
  isValidElement,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Check, Copy, Loader2, SquarePen } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import rehypeHighlight from "rehype-highlight";
import {
  MarkdownInteractionContext,
  MermaidBlock,
  directiveComponents,
  remarkDirectiveToHast,
} from "./markdownDirectives";
export interface ToolCallDisplay {
  toolName: string;
  payload?: unknown;
}

export type InlineWriteupPayload = {
  noteId?: string;
  title: string;
  summary?: string;
  /** Legacy inline body or live stream buffer fallback */
  body?: string;
  attachedToMessage?: boolean;
};

export type LiveNoteStream = {
  noteId: string;
  title: string;
  summary: string;
  body: string;
};

type NoteCreatePayload = {
  note?: { id?: string; title?: string; content?: string };
  attachedToMessage?: boolean;
  summary?: string;
};

function parseNoteCreatePayload(payload: unknown): NoteCreatePayload | null {
  if (!payload || typeof payload !== "object") return null;
  return payload as NoteCreatePayload;
}

function parseLegacyDocumentPayload(payload: unknown): InlineWriteupPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.title !== "string") return null;
  return {
    title: p.title,
    summary: typeof p.summary === "string" ? p.summary : undefined,
    body: typeof p.body === "string" ? p.body : undefined,
    attachedToMessage: true,
  };
}

export function getInlineWriteup(toolCalls?: ToolCallDisplay[]): InlineWriteupPayload | null {
  if (!toolCalls?.length) return null;

  const noteCreates = toolCalls.filter((tc) => tc.toolName === "note_create");
  for (const call of noteCreates) {
    const parsed = parseNoteCreatePayload(call.payload);
    if (!parsed?.attachedToMessage) continue;
    const title = parsed.note?.title?.trim();
    if (!title) continue;
    return {
      noteId: parsed.note?.id,
      title,
      summary: parsed.summary,
      body: parsed.note?.content,
      attachedToMessage: true,
    };
  }

  const legacy = toolCalls.filter((tc) => tc.toolName === "open_long_response");
  let best: InlineWriteupPayload | null = null;
  for (const call of legacy) {
    const parsed = parseLegacyDocumentPayload(call.payload);
    if (!parsed) continue;
    if (!best || (parsed.body?.length ?? 0) >= (best.body?.length ?? 0)) best = parsed;
  }
  return best;
}

export function isAttachedNoteCreate(call: ToolCallDisplay): boolean {
  if (call.toolName !== "note_create") return false;
  const parsed = parseNoteCreatePayload(call.payload);
  return parsed?.attachedToMessage === true;
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

/** Default note title when saving a chat message to the editor. */
export function formatMessageNoteTitle(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
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

export interface MarkdownContentProps {
  content: string;
  /** Used to build stable keys for per-block copy / save actions. */
  messageId?: string;
  messageTimestamp?: number;
  copiedId?: string | null;
  savedToNotesId?: string | null;
  onCopied?: (id: string | null) => void;
  onSaveToNotes?: (id: string, content: string, messageTimestamp?: number) => void | Promise<void>;
  /** When set, `:::option` directives render as clickable buttons that call this handler. */
  onOptionSelect?: (label: string) => void | Promise<void>;
}

function CodeBlock({
  blockKey,
  codeText,
  copiedId,
  savedToNotesId,
  onCopied,
  onSaveToNotes,
  messageTimestamp,
  children,
  ...rest
}: {
  blockKey: string;
  codeText: string;
  copiedId?: string | null;
  savedToNotesId?: string | null;
  onCopied?: (id: string | null) => void;
  onSaveToNotes?: (id: string, content: string, messageTimestamp?: number) => void | Promise<void>;
  messageTimestamp?: number;
  children?: ReactNode;
}) {
  const [localCopied, setLocalCopied] = useState(false);
  const justCopied = onCopied ? copiedId === blockKey : localCopied;
  const justSaved = savedToNotesId === blockKey;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeText);
      if (onCopied) {
        onCopied(blockKey);
        setTimeout(() => onCopied(null), 2000);
      } else {
        setLocalCopied(true);
        setTimeout(() => setLocalCopied(false), 2000);
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="md-code-block">
      <div className="md-code-block__toolbar">
        {onSaveToNotes ? (
          <button
            type="button"
            className="md-code-block__btn"
            onClick={() => void onSaveToNotes(blockKey, codeText, messageTimestamp)}
            disabled={!codeText.trim()}
            title={justSaved ? "Added to editor" : "Add to editor"}
            aria-label={justSaved ? "Added to editor" : "Add code to editor"}
          >
            {justSaved ? <Check size={12} /> : <SquarePen size={12} />}
          </button>
        ) : null}
        <button
          type="button"
          className="md-code-block__btn"
          onClick={() => void handleCopy()}
          title={justCopied ? "Copied!" : "Copy"}
          aria-label={justCopied ? "Copied!" : "Copy code"}
        >
          {justCopied ? <Check size={12} /> : <Copy size={12} />}
        </button>
      </div>
      <pre {...rest}>{children}</pre>
    </div>
  );
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
  messageId,
  messageTimestamp,
  copiedId,
  savedToNotesId,
  onCopied,
  onSaveToNotes,
  onOptionSelect,
}: MarkdownContentProps) {
  const codeBlockIndexRef = useRef(0);
  codeBlockIndexRef.current = 0;
  const markdownInteraction = useMemo(
    () => (onOptionSelect ? { onOptionSelect } : {}),
    [onOptionSelect],
  );

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
    const blockIndex = codeBlockIndexRef.current;
    codeBlockIndexRef.current += 1;
    const blockKey = messageId != null ? `${messageId}:code:${blockIndex}` : `code:${blockIndex}`;
    const codeText = extractCodeText(children);
    return (
      <CodeBlock
        blockKey={blockKey}
        codeText={codeText}
        copiedId={copiedId}
        savedToNotesId={savedToNotesId}
        onCopied={onCopied}
        onSaveToNotes={onSaveToNotes}
        messageTimestamp={messageTimestamp}
        {...rest}
      >
        {children}
      </CodeBlock>
    );
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
    <MarkdownInteractionContext.Provider value={markdownInteraction}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkDirectiveToHast]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </MarkdownInteractionContext.Provider>
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

export function toolCallLabel(call: ToolCallDisplay): string {
  if (call.toolName === "note_create") {
    const parsed = parseNoteCreatePayload(call.payload);
    if (parsed?.attachedToMessage && parsed.note?.title?.trim()) {
      return parsed.note.title.trim();
    }
    return "Created note";
  }
  if (call.toolName === "open_long_response") {
    const legacy = parseLegacyDocumentPayload(call.payload);
    if (legacy?.title) return legacy.title;
    return "Long write-up";
  }
  return toolLabel(call.toolName);
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
  messageTimestamp,
  savedNoteId,
  onSaveToNotes,
}: {
  content: string;
  messageId: string;
  messageTimestamp?: number;
  savedNoteId: string | null;
  onSaveToNotes: (messageId: string, content: string, messageTimestamp?: number) => void | Promise<void>;
}) {
  const justSaved = savedNoteId === messageId;
  return (
    <button
      type="button"
      className="message-footer-icon-btn"
      onClick={() => void onSaveToNotes(messageId, content, messageTimestamp)}
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
