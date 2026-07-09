import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Maximize2, SquarePen, X } from "lucide-react";
import { MarkdownContent } from "./chatHelpers";
import type { InlineWriteupPayload, LiveNoteStream } from "./chatHelpers";

const SCROLL_PIN_THRESHOLD_PX = 24;

interface DocumentCardProps {
  title: string;
  body: string;
  noteId?: string;
  loading?: boolean;
  error?: string | null;
  streaming?: boolean;
  onOpenInEditor?: (noteId: string) => void;
}

function useScrollFollow(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  body: string,
  streaming: boolean,
) {
  const [pinnedToBottom, setPinnedToBottom] = useState(true);
  const [showFade, setShowFade] = useState(false);

  const updateFade = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowFade(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_PIN_THRESHOLD_PX;
      setPinnedToBottom(atBottom);
      updateFade();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    updateFade();
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, updateFade]);

  useEffect(() => {
    updateFade();
  }, [body, updateFade]);

  useEffect(() => {
    if (!streaming || !pinnedToBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    updateFade();
  }, [body, streaming, pinnedToBottom, scrollRef, updateFade]);

  return { showFade };
}

export function DocumentCard({
  title,
  body,
  noteId,
  loading = false,
  error = null,
  streaming = false,
  onOpenInEditor,
}: DocumentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const inlineScrollRef = useRef<HTMLDivElement>(null);
  const modalScrollRef = useRef<HTMLDivElement>(null);
  const { showFade: inlineFade } = useScrollFollow(inlineScrollRef, body, streaming);
  const { showFade: modalFade } = useScrollFollow(modalScrollRef, body, streaming && expanded);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setExpanded(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  const handleCopy = async () => {
    if (!body.trim()) return;
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const toolbarButtons = (includeExpand: boolean) => (
    <>
      {noteId && onOpenInEditor && !streaming ? (
        <button
          type="button"
          className="md-code-block__btn"
          onClick={() => onOpenInEditor(noteId)}
          title="Open in Editor"
          aria-label="Open in Editor"
        >
          <SquarePen size={12} />
        </button>
      ) : null}
      {includeExpand ? (
        <button
          type="button"
          className="md-code-block__btn"
          onClick={() => setExpanded(true)}
          title="Expand"
          aria-label="Open full screen"
        >
          <Maximize2 size={12} />
        </button>
      ) : (
        <button
          type="button"
          className="md-code-block__btn"
          onClick={() => setExpanded(false)}
          title="Close"
          aria-label="Close full screen"
        >
          <X size={12} />
        </button>
      )}
      <button
        type="button"
        className="md-code-block__btn"
        onClick={() => void handleCopy()}
        disabled={!body.trim()}
        title={copied ? "Copied!" : "Copy"}
        aria-label={copied ? "Copied!" : "Copy note content"}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </>
  );

  const bodyContent = loading ? (
    <p className="document-card__placeholder">Loading note…</p>
  ) : error ? (
    <p className="document-card__placeholder document-card__placeholder--error">{error}</p>
  ) : (
    <MarkdownContent content={body} />
  );

  const expandedModal =
    expanded &&
    createPortal(
      <div
        className="document-card-modal-backdrop"
        role="presentation"
        onClick={(e) => {
          if (e.target === e.currentTarget) setExpanded(false);
        }}
      >
        <div
          className="document-card-modal"
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onClick={(e) => e.stopPropagation()}
        >
          <span className="document-card__label">{title}</span>
          <div className="document-card__surface document-card__surface--modal">
            <div className="md-code-block__toolbar">{toolbarButtons(false)}</div>
            <div className="document-card__body" ref={modalScrollRef}>
              {bodyContent}
            </div>
            {modalFade && <div className="document-card__fade" aria-hidden />}
          </div>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div className="document-card">
        <span className="document-card__label">{title}</span>
        <div className="document-card__surface">
          <div className="md-code-block__toolbar">{toolbarButtons(true)}</div>
          <div className="document-card__body" ref={inlineScrollRef}>
            {bodyContent}
          </div>
          {inlineFade && <div className="document-card__fade" aria-hidden />}
        </div>
      </div>
      {expandedModal}
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
      noteId={writeup.noteId}
      loading={loading && !body}
      error={error}
      streaming={isLive}
      onOpenInEditor={onOpenInEditor}
    />
  );
}
