import {
  isValidElement,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Check, Copy, SquarePen } from "lucide-react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import rehypeHighlight from "rehype-highlight";
import { formatMediumTimestamp } from "../shared/formatMediumTimestamp";
import {
  MarkdownInteractionContext,
  directiveComponents,
  remarkDirectiveToHast,
} from "./markdownDirectives";
import {
  libraryRefFallbackLabel,
  memorySearchHitsFromPayload,
  parseLibraryHref,
  type LibraryRef,
  type MemorySearchHit,
} from "../shared/conversationSearch";
import { parseLocalFilePath } from "../shared/localFilePath";
import { scheduleCopyFeedbackClear, useCopyFeedback } from "./useCopyFeedback";

export type { MemorySearchHit };
export { memorySearchHitsFromPayload };

export function memorySearchHitsFromToolCall(call: ToolCallDisplay): MemorySearchHit[] {
  if (call.toolName !== "memory_search_conversations") return [];
  return memorySearchHitsFromPayload(call.payload);
}
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

/** Note id from a successful `note_create` / legacy write-up tool payload, if present. */
export function noteIdFromCreateToolCall(call: ToolCallDisplay): string | null {
  if (call.toolName === "note_create") {
    const id = parseNoteCreatePayload(call.payload)?.note?.id?.trim();
    return id || null;
  }
  if (call.toolName === "open_long_response") {
    const p = call.payload as { noteId?: string } | undefined;
    const id = typeof p?.noteId === "string" ? p.noteId.trim() : "";
    return id || null;
  }
  return null;
}

function noteTitleFromCreateToolCall(call: ToolCallDisplay): string | null {
  if (call.toolName === "note_create") {
    const title = parseNoteCreatePayload(call.payload)?.note?.title?.trim();
    return title || null;
  }
  if (call.toolName === "open_long_response") {
    const parsed = parseLegacyDocumentPayload(call.payload);
    const title = parsed?.title?.trim();
    return title || null;
  }
  return null;
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
  return formatMediumTimestamp(ts);
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
  libraryHits?: MemorySearchHit[];
  onOpenConversation?: (conversationId: string) => void;
  onOpenNote?: (noteId: string) => void;
  onOpenImage?: (imageId: string) => void;
}

function LibraryRefLink({
  libraryRef,
  children,
  titles,
  onOpen,
}: {
  libraryRef: LibraryRef;
  children?: ReactNode;
  titles: Map<string, string>;
  onOpen?: (ref: LibraryRef) => void;
}) {
  const text = extractCodeText(children).trim();
  const label =
    text && !parseLibraryHref(text) ? children : titles.get(libraryRef.id) || libraryRefFallbackLabel(libraryRef.target);
  return onOpen ? (
    <button type="button" className="library-ref" onClick={() => onOpen(libraryRef)}>
      {label}
    </button>
  ) : (
    <span className="library-ref library-ref--static">{label}</span>
  );
}

function FilePathLink({ path, children }: { path: string; children?: ReactNode }) {
  const label = children ?? path;
  const open = () => {
    const api = window.harness?.system?.showInFolder;
    if (!api) return;
    void api(path).catch(() => {
      /* ignore missing paths / browser shell */
    });
  };
  return (
    <button
      type="button"
      className="library-ref"
      onClick={open}
      title={`Show in Finder: ${path}`}
    >
      {label}
    </button>
  );
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
  const { copied: localCopied, copyText } = useCopyFeedback();
  const justCopied = onCopied ? copiedId === blockKey : localCopied;
  const justSaved = savedToNotesId === blockKey;

  const handleCopy = async () => {
    if (onCopied) {
      try {
        await navigator.clipboard.writeText(codeText);
        onCopied(blockKey);
        scheduleCopyFeedbackClear(() => onCopied(null));
      } catch {
        /* ignore */
      }
      return;
    }
    await copyText(codeText);
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
 * Fenced code blocks flow through highlight.js via `CodeBlock`.
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
  libraryHits,
  onOpenConversation,
  onOpenNote,
  onOpenImage,
}: MarkdownContentProps) {
  const codeBlockIndexRef = useRef(0);
  codeBlockIndexRef.current = 0;
  const markdownInteraction = useMemo(
    () => (onOptionSelect ? { onOptionSelect } : {}),
    [onOptionSelect],
  );
  const libraryTitles = useMemo(() => {
    const map = new Map<string, string>();
    for (const hit of libraryHits ?? []) map.set(hit.id, hit.title);
    return map;
  }, [libraryHits]);
  const openLibrary =
    onOpenConversation || onOpenNote || onOpenImage
      ? (ref: LibraryRef) => {
          if (ref.target === "conversation") onOpenConversation?.(ref.id);
          else if (ref.target === "note") onOpenNote?.(ref.id);
          else onOpenImage?.(ref.id);
        }
      : undefined;

  const headingAsParagraph = ({ children, ...props }: { children?: ReactNode }) => (
    <p {...props}>{children}</p>
  );
  const preComponent = ({ children, ...rest }: { children?: ReactNode }) => {
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
    a: ({ href, children, ...props }: { href?: string; children?: ReactNode }) => {
      const ref = href ? parseLibraryHref(href) : null;
      if (ref) {
        return (
          <LibraryRefLink libraryRef={ref} titles={libraryTitles} onOpen={openLibrary}>
            {children}
          </LibraryRefLink>
        );
      }
      const filePath = href ? parseLocalFilePath(href) : null;
      if (filePath) {
        return <FilePathLink path={filePath}>{children}</FilePathLink>;
      }
      return <a href={href} {...props}>{children}</a>;
    },
    code: ({ className, children, ...props }: { className?: string; children?: ReactNode }) => {
      const text = extractCodeText(children).trim();
      const ref = className ? null : parseLibraryHref(text);
      if (ref) {
        return (
          <LibraryRefLink libraryRef={ref} titles={libraryTitles} onOpen={openLibrary}>
            {children}
          </LibraryRefLink>
        );
      }
      const filePath = className ? null : parseLocalFilePath(text);
      if (filePath) {
        return <FilePathLink path={filePath}>{children}</FilePathLink>;
      }
      return <code className={className} {...props}>{children}</code>;
    },
    ...directiveComponents,
  } as unknown as Components;

  return (
    <MarkdownInteractionContext.Provider value={markdownInteraction}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkDirectiveToHast]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        urlTransform={(url) => (/^file:/i.test(url.trim()) ? url : defaultUrlTransform(url))}
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
  if (call.toolName === "note_create" || call.toolName === "open_long_response") {
    const title = noteTitleFromCreateToolCall(call);
    return title ? `Created “${title}”` : "Created note";
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
    memory_set: "Updated context",
    memory_list: "Listed context",
    // Display aliases for older tool IDs in chat history.
    memory_set_fact: "Updated context",
    memory_list_facts: "Listed context",
    memory_search_conversations: "Searched library",
    get_datetime: "Checked date & time",
    note_list: "Listed notes",
    note_create: "Created note",
    note_read: "Read note",
    note_save: "Saved note",
    note_delete: "Deleted note",
    set_layout: "Updated layout",
    ws_list_tree: "Listed project files",
    ws_search: "Searched project",
    ws_read: "Read file",
    ws_edit: "Edit file",
    ws_write: "Write file",
    ws_delete: "Delete file",
    run_command: "Run command",
    git_status: "Git status",
    git_diff: "Git diff",
    git_checkout_branch: "Checkout branch",
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
      scheduleCopyFeedbackClear(() => onCopied(null));
    } catch {
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

export type VoiceState = "idle" | "recording" | "processing";
