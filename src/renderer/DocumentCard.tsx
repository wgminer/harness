import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
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
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function formatWordCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "word" : "words"}`;
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
}: DocumentCardProps) {
  const canOpenInEditor = !!noteId && !!onOpenInEditor && !error;
  const pillTitle = error ? "Couldn't open note" : loading ? "Loading note…" : title;
  const pillMeta = documentPillMeta({ summary, body, loading, error, streaming });
  const pillBusy = loading || streaming;

  const handlePillClick = () => {
    if (!canOpenInEditor) return;
    onOpenInEditor!(noteId!);
  };

  return (
    <div className="document-card">
      <button
        type="button"
        className={[
          "document-card__pill",
          error ? "document-card__pill--error" : null,
          streaming ? "document-card__pill--streaming" : null,
        ]
          .filter(Boolean)
          .join(" ")}
        onClick={handlePillClick}
        disabled={!canOpenInEditor}
        title={error ?? (canOpenInEditor ? `Open “${title}”` : title)}
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
      </button>
    </div>
  );
}

export function InlineWriteupCard({
  writeup,
  liveStream,
  streaming = false,
  onOpenInEditor,
  onBodyLoaded,
}: {
  writeup: InlineWriteupPayload;
  liveStream?: LiveNoteStream | null;
  streaming?: boolean;
  onOpenInEditor?: (noteId: string) => void;
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
    />
  );
}
