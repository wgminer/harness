import { useCallback, useEffect, useRef, useState } from "react";
import { Pin, PinOff } from "lucide-react";
import {
  joinNoteTitleAndBody,
  splitNoteTitleAndBody,
  stripLeadingMarkdownHeading,
} from "../shared/writing";

const AUTO_SAVE_DEBOUNCE_MS = 800;

interface StickyNoteViewProps {
  noteId: string;
}

export function StickyNoteView({ noteId }: StickyNoteViewProps) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const alwaysOnTop = await getCurrentWebviewWindow().isAlwaysOnTop();
        if (!cancelled) setPinned(alwaysOnTop);
      } catch {
        // ignore outside Tauri
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const note = await window.harness.notes.read(noteId);
        if (cancelled) return;
        if (!note) {
          setError("Note not found.");
          setLoading(false);
          return;
        }
        const split = splitNoteTitleAndBody(note.content);
        setTitle(displayNoteTitle(split.title || note.title));
        setBody(split.body);
        setSavedContent(note.content);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noteId]);

  const persist = useCallback(
    async (nextTitle: string, nextBody: string) => {
      const content = joinNoteTitleAndBody(nextTitle, nextBody);
      if (content === savedContent) return;
      try {
        const note = await window.harness.notes.save(noteId, content);
        setSavedContent(note.content);
        const displayTitle = displayNoteTitle(nextTitle.trim() || note.title);
        await window.harness.notes.setStickyTitle(noteId, displayTitle);
      } catch (e) {
        setError(String(e));
      }
    },
    [noteId, savedContent],
  );

  const scheduleSave = useCallback(
    (nextTitle: string, nextBody: string) => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = window.setTimeout(() => {
        void persist(nextTitle, nextBody);
      }, AUTO_SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  useEffect(
    () => () => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
    },
    [],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      setTitle(value);
      scheduleSave(value, body);
    },
    [body, scheduleSave],
  );

  const handleBodyChange = useCallback(
    (value: string) => {
      setBody(value);
      scheduleSave(title, value);
    },
    [scheduleSave, title],
  );

  const togglePin = useCallback(async () => {
    const next = !pinned;
    setPinned(next);
    try {
      await window.harness.notes.setStickyPinned(noteId, next);
    } catch (e) {
      setPinned(!next);
      setError(String(e));
    }
  }, [noteId, pinned]);

  if (loading) {
    return (
      <div className="sticky-note" data-testid="sticky-note-loading">
        <p className="sticky-note__status">Loading…</p>
      </div>
    );
  }

  if (error && !savedContent) {
    return (
      <div className="sticky-note" data-testid="sticky-note-error">
        <p className="sticky-note__status sticky-note__status--error">{error}</p>
      </div>
    );
  }

  return (
    <div className="sticky-note" data-testid="sticky-note">
      <header className="sticky-note__header">
        <input
          type="text"
          className="sticky-note__title"
          value={title}
          onChange={(e) => handleTitleChange(e.target.value)}
          placeholder="Untitled"
          aria-label="Note title"
        />
        <button
          type="button"
          className={`btn btn-icon sticky-note__pin${pinned ? " sticky-note__pin--active" : ""}`}
          onClick={() => void togglePin()}
          aria-label={pinned ? "Unpin note window" : "Pin note window on top"}
          aria-pressed={pinned}
          data-testid="sticky-note-pin"
        >
          {pinned ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />}
        </button>
      </header>
      <textarea
        className="sticky-note__body"
        value={body}
        onChange={(e) => handleBodyChange(e.target.value)}
        placeholder="Write a note…"
        aria-label="Note body"
      />
      {error ? <p className="sticky-note__inline-error">{error}</p> : null}
    </div>
  );
}

function displayNoteTitle(title: string): string {
  const stripped = stripLeadingMarkdownHeading(title);
  return stripped || title || "Untitled";
}
