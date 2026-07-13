import { useCallback, useEffect, useRef, useState } from "react";
import { PictureInPicture2, SquareArrowDownLeft } from "lucide-react";
import {
  stripLeadingMarkdownHeading,
  titleFromMarkdownContent,
  UNTITLED_NOTE_TITLE,
} from "../shared/writing";
import { NotesCodeEditor } from "./NotesCodeEditor";

const AUTO_SAVE_DEBOUNCE_MS = 800;

interface WindowedNoteViewProps {
  noteId: string;
}

export function WindowedNoteView({ noteId }: WindowedNoteViewProps) {
  const [draft, setDraft] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [fallbackTitle, setFallbackTitle] = useState(UNTITLED_NOTE_TITLE);
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const draftRef = useRef(draft);
  const savedContentRef = useRef(savedContent);
  const fallbackTitleRef = useRef(fallbackTitle);

  draftRef.current = draft;
  savedContentRef.current = savedContent;
  fallbackTitleRef.current = fallbackTitle;

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
        setDraft(note.content);
        setSavedContent(note.content);
        setFallbackTitle(displayNoteTitle(note.title));
        setLoading(false);
        await window.harness.notes.setStickyTitle(noteId, displayNoteTitle(note.title));
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
    async (content: string) => {
      if (content === savedContentRef.current) return;
      try {
        const note = await window.harness.notes.save(noteId, content);
        setSavedContent(note.content);
        savedContentRef.current = note.content;
        const displayTitle = displayNoteTitle(note.title);
        setFallbackTitle(displayTitle);
        fallbackTitleRef.current = displayTitle;
        await window.harness.notes.setStickyTitle(noteId, displayTitle);
      } catch (e) {
        setError(String(e));
      }
    },
    [noteId],
  );

  const flushSave = useCallback(async () => {
    if (autoSaveTimerRef.current != null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    await persist(draftRef.current);
  }, [persist]);

  const scheduleSave = useCallback(
    (content: string) => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = window.setTimeout(() => {
        void persist(content);
      }, AUTO_SAVE_DEBOUNCE_MS);
      const liveTitle = titleFromMarkdownContent(content, fallbackTitleRef.current);
      void window.harness.notes.setStickyTitle(noteId, displayNoteTitle(liveTitle));
    },
    [noteId, persist],
  );

  useEffect(
    () => () => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
      const content = draftRef.current;
      if (content !== savedContentRef.current) {
        void window.harness.notes.save(noteId, content).catch(() => {});
      }
    },
    [noteId],
  );

  const handleChange = useCallback(
    (value: string) => {
      setDraft(value);
      scheduleSave(value);
    },
    [scheduleSave],
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

  const popIn = useCallback(async () => {
    try {
      await flushSave();
      await window.harness.notes.popInSticky(noteId);
    } catch (e) {
      setError(String(e));
    }
  }, [flushSave, noteId]);

  if (loading) {
    return (
      <div className="windowed-note" data-testid="windowed-note-loading">
        <p className="windowed-note__status">Loading…</p>
      </div>
    );
  }

  if (error && !savedContent) {
    return (
      <div className="windowed-note" data-testid="windowed-note-error">
        <p className="windowed-note__status windowed-note__status--error">{error}</p>
      </div>
    );
  }

  return (
    <div className="windowed-note" data-testid="windowed-note">
      <div className="windowed-note__editor-wrap">
        <NotesCodeEditor
          className="windowed-note__editor notes-code-editor"
          data-testid="windowed-note-editor"
          aria-label="Note"
          placeholder="Write your note here..."
          value={draft}
          onChange={handleChange}
        />
      </div>
      <div className="windowed-note__actions">
        <button
          type="button"
          className="btn btn-icon windowed-note__action"
          onClick={() => void popIn()}
          aria-label="Open note in main window"
          title="Open in Harness"
          data-testid="windowed-note-pop-in"
        >
          <SquareArrowDownLeft size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={`btn btn-icon windowed-note__action${pinned ? " windowed-note__action--active" : ""}`}
          onClick={() => void togglePin()}
          aria-label={pinned ? "Unpin note window" : "Pin note window on top"}
          aria-pressed={pinned}
          title={pinned ? "Unpin" : "Pin on top"}
          data-testid="windowed-note-pin"
        >
          <PictureInPicture2 size={14} aria-hidden />
        </button>
      </div>
      {error ? <p className="windowed-note__inline-error">{error}</p> : null}
    </div>
  );
}

function displayNoteTitle(title: string): string {
  const stripped = stripLeadingMarkdownHeading(title);
  return stripped || title || UNTITLED_NOTE_TITLE;
}
