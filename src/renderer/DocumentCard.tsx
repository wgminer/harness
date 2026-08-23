import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, FileText, Loader2 } from "lucide-react";
import { buildNotePrintHtml } from "../shared/notePrint";
import { MarkdownContent } from "./chatHelpers";
import type { InlineWriteupPayload, LiveNoteStream } from "./chatHelpers";
import { Modal } from "./Modal";

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
  const [copied, setCopied] = useState(false);
  const [printing, setPrinting] = useState(false);
  const bodyScrollRef = useRef<HTMLDivElement>(null);

  useScrollFollow(bodyScrollRef, body, streaming, open);

  const handleCopy = useCallback(async () => {
    if (!body.trim()) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }, [body]);

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

  const handleOpenInEditor = useCallback(() => {
    if (!noteId || !onOpenInEditor || streaming) return;
    setOpen(false);
    onOpenInEditor(noteId);
  }, [noteId, onOpenInEditor, streaming]);

  const canAct = !loading && !error && !!body.trim();
  const canOpenInEditor = !!noteId && !!onOpenInEditor && !streaming;

  const bodyContent = loading ? (
    <p className="document-card__placeholder">Loading note…</p>
  ) : error ? (
    <p className="document-card__placeholder document-card__placeholder--error">{error}</p>
  ) : (
    <div ref={bodyScrollRef} className="document-card-reader">
      <MarkdownContent content={body} />
    </div>
  );

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
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={
            error ??
            ([title, summary?.trim()].filter(Boolean).join(" — ") || title)
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
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={pillTitle}
        size="lg"
        variant="scrollable"
        data-testid="document-card-reader"
        footer={
          <>
            {canOpenInEditor ? (
              <button type="button" className="btn btn-primary" onClick={handleOpenInEditor}>
                Open in Editor
              </button>
            ) : null}
            <div className="app-modal-footer-actions">
              <button
                type="button"
                className="btn"
                onClick={() => void handlePrint()}
                disabled={!canAct || printing}
              >
                Print
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void handleCopy()}
                disabled={!canAct}
              >
                {copied ? (
                  <>
                    <Check size={14} aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy size={14} aria-hidden />
                    Copy
                  </>
                )}
              </button>
            </div>
          </>
        }
        footerClassName="app-modal-footer--spread"
      >
        {bodyContent}
      </Modal>
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
