import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FileText, Loader2, SquareArrowOutUpRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { countWords, formatWordCount } from "../../shared/wordCount";
import type { InlineWriteupPayload, LiveNoteStream } from "./chatHelpers";

interface DocumentCardProps {
  title: string;
  body: string;
  summary?: string;
  noteId?: string;
  loading?: boolean;
  error?: string | null;
  streaming?: boolean;
  onOpenInEditor?: (noteId: string) => void;
  onOpenInWindow?: (noteId: string) => void;
}

function documentPillMeta({
  summary,
  body,
  loading,
  error,
  streaming,
}: {
  summary?: string;
  body: string;
  loading: boolean;
  error: string | null;
  streaming: boolean;
}): string {
  if (error) return error;
  if (loading) return "Loading note…";

  const parts: string[] = ["Note"];
  if (streaming) {
    parts.push("Writing…");
    const words = countWords(body);
    if (words > 0) parts.push(formatWordCount(words));
  } else {
    const words = countWords(body);
    if (words > 0) parts.push(formatWordCount(words));
  }

  const summaryText = summary?.trim();
  if (summaryText) parts.push(summaryText);

  return parts.join(" · ");
}

export function DocumentCard({
  title,
  body,
  summary,
  noteId,
  loading = false,
  error = null,
  streaming = false,
  onOpenInEditor,
  onOpenInWindow,
}: DocumentCardProps) {
  // Review happens in the thread: the card expands to the rendered note, and
  // editing is an explicit hop to the Notes view or a standalone window.
  const [expanded, setExpanded] = useState(false);
  const canOpen = !!noteId && !error;
  const canExpand = !error && !streaming && !!body.trim();
  const showBody = canExpand && expanded;
  const pillTitle = error ? "Couldn't open note" : loading ? "Loading note…" : title;
  const pillMeta = documentPillMeta({ summary, body, loading, error, streaming });
  const pillBusy = loading || streaming;
  const reviewBody = useMemo(() => stripLeadingH1(body), [body]);

  return (
    <div className={["document-card", showBody ? "document-card--expanded" : null].filter(Boolean).join(" ")}>
      <div className="document-card__header">
        <button
          type="button"
          className={[
            "document-card__pill",
            error ? "document-card__pill--error" : null,
            streaming ? "document-card__pill--streaming" : null,
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => setExpanded((v) => !v)}
          disabled={!canExpand}
          aria-expanded={canExpand ? showBody : undefined}
          title={error ?? (canExpand ? (showBody ? "Collapse" : `Review “${title}”`) : title)}
        >
          {pillBusy ? (
            <Loader2 size={18} className="document-card__pill-spinner" aria-hidden />
          ) : (
            <FileText size={18} aria-hidden />
          )}
          <span className="document-card__pill-text">
            <span className="document-card__pill-title">{pillTitle}</span>
            <span className="document-card__pill-meta">{pillMeta}</span>
          </span>
          {canExpand ? (
            <ChevronDown
              size={16}
              className={["document-card__chevron", showBody ? "document-card__chevron--open" : null]
                .filter(Boolean)
                .join(" ")}
              aria-hidden
            />
          ) : null}
        </button>
        {canOpen && !streaming && (onOpenInEditor || onOpenInWindow) ? (
          <div className="document-card__actions">
            {onOpenInEditor ? (
              <button
                type="button"
                className="btn btn-sm document-card__action"
                onClick={() => onOpenInEditor(noteId!)}
                title="Open in Notes"
              >
                Open
              </button>
            ) : null}
            {onOpenInWindow ? (
              <button
                type="button"
                className="btn btn-icon-sm document-card__action"
                onClick={() => onOpenInWindow(noteId!)}
                aria-label="Edit in its own window"
                title="Edit in its own window"
              >
                <SquareArrowOutUpRight size={14} aria-hidden />
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {showBody ? (
        <div className="document-card__body" data-testid="document-card-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{reviewBody}</ReactMarkdown>
        </div>
      ) : null}
    </div>
  );
}

/** The card header already shows the title, so drop the note's leading `# H1`. */
function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^\s*#\s+[^\n]*\n?/, "");
}

export function InlineWriteupCard({
  writeup,
  liveStream,
  streaming = false,
  onOpenInEditor,
  onOpenInWindow,
  onBodyLoaded,
}: {
  writeup: InlineWriteupPayload;
  liveStream?: LiveNoteStream | null;
  streaming?: boolean;
  onOpenInEditor?: (noteId: string) => void;
  onOpenInWindow?: (noteId: string) => void;
  onBodyLoaded?: (noteId: string, body: string) => void;
}) {
  const [fetchedBody, setFetchedBody] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLive =
    streaming &&
    !!liveStream &&
    (!writeup.noteId || liveStream.noteId === writeup.noteId);

  const body = isLive
    ? liveStream!.body || writeup.body || ""
    : writeup.body ?? fetchedBody ?? "";
  const summary = isLive
    ? liveStream!.summary || writeup.summary
    : writeup.summary;

  useEffect(() => {
    if (isLive || writeup.body || !writeup.noteId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void window.harness.notes
      .read(writeup.noteId)
      .then((note) => {
        if (cancelled) return;
        if (note) {
          setFetchedBody(note.content);
          onBodyLoaded?.(writeup.noteId!, note.content);
        } else {
          setError("Note not found");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load note");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLive, onBodyLoaded, writeup.body, writeup.noteId]);

  return (
    <DocumentCard
      title={writeup.title}
      body={body}
      summary={summary}
      noteId={writeup.noteId}
      loading={loading && !body}
      error={error}
      streaming={isLive}
      onOpenInEditor={onOpenInEditor}
      onOpenInWindow={onOpenInWindow}
    />
  );
}
