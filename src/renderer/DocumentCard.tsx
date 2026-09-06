import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, FileText, Loader2, Printer, SquarePen, X } from "lucide-react";
import { buildNotePrintHtml } from "../shared/notePrint";
import { countWords, formatWordCount } from "../shared/wordCount";
import { MarkdownContent } from "./chatHelpers";
import type { InlineWriteupPayload, LiveNoteStream } from "./chatHelpers";
import { useCopyFeedback } from "./useCopyFeedback";
import { useDismissible } from "./useDismissible";

const SCROLL_PIN_THRESHOLD_PX = 24;

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

function useScrollFollow(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  body: string,
  streaming: boolean,
  active: boolean,
) {
  const [pinnedToBottom, setPinnedToBottom] = useState(true);

  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_PIN_THRESHOLD_PX;
      setPinnedToBottom(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [active, scrollRef]);

  useEffect(() => {
    if (!active || !streaming || !pinnedToBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active, body, streaming, pinnedToBottom, scrollRef]);
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
  const [open, setOpen] = useState(false);
  const { copied, copyText } = useCopyFeedback();
  const [printing, setPrinting] = useState(false);
  const sheetScrollRef = useRef<HTMLDivElement>(null);
  const wasStreamingRef = useRef(false);

  useScrollFollow(sheetScrollRef, body, streaming, open);

  // Auto-open while a writeup is streaming so the user can watch it land.
  useEffect(() => {
    if (streaming && !wasStreamingRef.current) {
      setOpen(true);
    }
    wasStreamingRef.current = streaming;
  }, [streaming]);

  const closeOverlay = useCallback(() => setOpen(false), []);
  useDismissible({
    open,
    onDismiss: closeOverlay,
    escape: true,
    preventEscapeDefault: true,
  });

  const handleCopy = useCallback(async () => {
    if (!body.trim()) return;
    await copyText(body);
  }, [body, copyText]);

  const handlePrint = useCallback(async () => {
    if (!body.trim() || printing) return;
    setPrinting(true);
    try {
      const html = buildNotePrintHtml(title, body);
      await window.harness.notes.print(html, title.trim() || "Note");
    } catch {
      /* ignore */
    } finally {
      setPrinting(false);
    }
  }, [body, printing, title]);

  const canAct = !loading && !error && !!body.trim();

  const bodyContent = loading ? (
    <p className="document-card__placeholder">Loading note…</p>
  ) : error ? (
    <p className="document-card__placeholder document-card__placeholder--error">{error}</p>
  ) : (
    <MarkdownContent content={body} />
  );

  const overlay =
    open &&
    createPortal(
      <div
        className="document-card-overlay-backdrop"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
      >
        <div
          className="document-card-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="document-card-overlay__chrome">
            <div className="document-card-overlay__chrome-title">
              <FileText size={14} aria-hidden />
              <span>{title}</span>
            </div>
            <div className="document-card-overlay__actions">
              {noteId && onOpenInEditor && !streaming ? (
                <button
                  type="button"
                  className="btn btn-icon-sm"
                  onClick={() => onOpenInEditor(noteId)}
                  title="Open in Editor"
                  aria-label="Open in Editor"
                >
                  <SquarePen size={14} />
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-icon-sm"
                onClick={() => void handlePrint()}
                disabled={!canAct || printing}
                title="Print"
                aria-label="Print note"
              >
                <Printer size={14} />
              </button>
              <button
                type="button"
                className="btn btn-icon-sm"
                onClick={() => void handleCopy()}
                disabled={!canAct}
                title={copied ? "Copied!" : "Copy"}
                aria-label={copied ? "Copied!" : "Copy note content"}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
              <button
                type="button"
                className="btn btn-icon-sm"
                onClick={() => setOpen(false)}
                title="Close"
                aria-label="Close note"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          <article className="document-card-overlay__sheet" ref={sheetScrollRef}>
            <header className="document-card-overlay__masthead">
              <h1 className="document-card-overlay__heading">{title}</h1>
            </header>
            <div className="document-card-overlay__body">{bodyContent}</div>
          </article>
        </div>
      </div>,
      document.body,
    );

  const canOpenInEditor = !!noteId && !!onOpenInEditor && !streaming;

  const handlePillClick = () => {
    if (canOpenInEditor) {
      onOpenInEditor!(noteId!);
      return;
    }
    setOpen(true);
  };

  const pillTitle = error ? "Couldn't open note" : loading ? "Loading note…" : title;
  const pillMeta = documentPillMeta({ summary, body, loading, error, streaming });
  const pillBusy = loading || streaming;

  return (
    <>
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
          aria-haspopup={canOpenInEditor ? undefined : "dialog"}
          aria-expanded={canOpenInEditor ? undefined : open}
          title={
            error ??
            (canOpenInEditor
              ? `Open “${title}”`
              : [title, summary?.trim()].filter(Boolean).join(" — "))
          }
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
      {overlay}
    </>
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
