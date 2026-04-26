import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FolderOpen, Plus, Save, SquarePen, Trash2 } from "lucide-react";
import type { NoteSummary } from "../shared/writing";
import { useScrolledHeader } from "./useScrolledHeader";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "creating" }
  | { kind: "saving" }
  | { kind: "deleting" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

function formatUpdatedAt(ms: number): string {
  if (!ms) return "Never";
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function NotesView() {
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [screen, setScreen] = useState<"list" | "detail">("list");
  const [draft, setDraft] = useState<string>("");
  const [savedDraft, setSavedDraft] = useState<string>("");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const savedToastTimerRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [selectedNoteId, notes],
  );
  const notesApi = window.electron.notes;

  const loadNotes = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      const list = await notesApi.list();
      setNotes(list);
      setSelectedNoteId((prev) => (prev != null && list.some((note) => note.id === prev) ? prev : null));
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [notesApi]);

  const loadActiveNote = useCallback(async (id: string) => {
    try {
      const note = await notesApi.read(id);
      if (!note) {
        setStatus({ kind: "error", message: "Note not found" });
        return;
      }
      setSelectedNoteId(note.id);
      setDraft(note.content);
      setSavedDraft(note.content);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [notesApi]);

  useEffect(() => {
    void loadNotes();
    return () => {
      if (savedToastTimerRef.current != null) {
        window.clearTimeout(savedToastTimerRef.current);
      }
    };
  }, [loadNotes]);

  const dirty = draft !== savedDraft;

  const save = useCallback(async () => {
    if (!dirty || !selectedNoteId) return;
    setStatus({ kind: "saving" });
    try {
      const note = await notesApi.save(selectedNoteId, draft);
      setDraft(note.content);
      setSavedDraft(note.content);
      setNotes((prev) =>
        prev
          .map((item) => (item.id === note.id ? { ...item, title: note.title, updatedAt: note.updatedAt } : item))
          .sort((a, b) => b.updatedAt - a.updatedAt),
      );
      setStatus({ kind: "saved" });
      if (savedToastTimerRef.current != null) {
        window.clearTimeout(savedToastTimerRef.current);
      }
      savedToastTimerRef.current = window.setTimeout(() => {
        setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
      }, 1500);
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [selectedNoteId, dirty, draft, notesApi]);

  const createNote = useCallback(async () => {
    setStatus({ kind: "creating" });
    try {
      const note = await notesApi.create();
      const summary = { id: note.id, title: note.title, updatedAt: note.updatedAt, createdAt: note.createdAt };
      setNotes((prev) => [summary, ...prev].sort((a, b) => b.updatedAt - a.updatedAt));
      setSelectedNoteId(note.id);
      setDraft(note.content);
      setSavedDraft(note.content);
      setScreen("detail");
      setStatus({ kind: "idle" });
      editorRef.current?.focus();
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [notesApi]);

  const deleteActiveNote = useCallback(async () => {
    if (!selectedNoteId) return;
    setStatus({ kind: "deleting" });
    try {
      const next = await notesApi.delete(selectedNoteId);
      setNotes(next);
      setSelectedNoteId(null);
      setDraft("");
      setSavedDraft("");
      setScreen("list");
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [selectedNoteId, notesApi]);

  const openNote = useCallback(
    async (id: string) => {
      setSelectedNoteId(id);
      setScreen("detail");
      setStatus({ kind: "loading" });
      await loadActiveNote(id);
    },
    [loadActiveNote],
  );

  const goBackToList = useCallback(() => {
    setScreen("list");
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  return (
    <div className="settings-page notes-surface">
      {screen === "list" ? (
        <header className={`settings-header ${headerScrolled ? "settings-header--scrolled" : ""}`}>
          <div className="settings-header-inner">
            <div className="settings-header-title-row">
              <SquarePen size={18} />
              <h2 className="settings-title">Notes</h2>
            </div>
          </div>
        </header>
      ) : null}
      <div
        ref={scrollRef}
        className={`settings-scroll notes-surface__scroll${screen === "detail" ? " notes-surface__scroll--detail" : ""}`}
        onScroll={onScroll}
      >
        {screen === "list" ? (
          <section className="notes-surface__panel">
            <ul className="notes-surface__notes" aria-label="Notes list">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className="notes-surface__note-item"
                    onClick={() => void openNote(note.id)}
                  >
                    <span className="notes-surface__note-title">{note.title}</span>
                    <span className="notes-surface__note-time">{formatUpdatedAt(note.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {notes.length === 0 ? <p className="notes-surface__empty">No notes yet. Create one to get started.</p> : null}
            <button
              type="button"
              className="btn btn-primary notes-surface__new-note"
              onClick={() => void createNote()}
              disabled={status.kind === "creating" || status.kind === "saving" || status.kind === "deleting"}
            >
              <Plus size={14} />
              New note
            </button>
          </section>
        ) : (
          <>
            <div className="notes-surface__toolbar">
              <button
                type="button"
                className="btn btn-icon"
                onClick={goBackToList}
                aria-label="Back to notes"
                title="Back"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="notes-surface__meta">
                <strong>{activeNote?.title ?? "Note"}</strong>
              </div>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => void deleteActiveNote()}
                disabled={!selectedNoteId || status.kind === "saving" || status.kind === "deleting"}
                aria-label="Delete current note"
                title="Delete note"
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                className="btn notes-surface__show-file-btn"
                onClick={() => void window.electron.notes.showInFolder(selectedNoteId)}
                disabled={!selectedNoteId || status.kind === "saving" || status.kind === "deleting"}
              >
                <FolderOpen size={14} />
                Show file
              </button>
              <button
                type="button"
                className="btn btn-primary notes-surface__save-btn"
                onClick={() => void save()}
                disabled={!dirty || status.kind === "saving" || !selectedNoteId}
              >
                <Save size={14} />
                {status.kind === "saving" ? "Saving..." : "Save"}
              </button>
            </div>
            <textarea
              ref={editorRef}
              className="notes-surface__editor"
              data-testid="notes-editor"
              aria-label="Notes editor"
              placeholder={status.kind === "loading" ? "Loading..." : "Write your note here..."}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck
            />
            {status.kind === "error" ? <p className="notes-surface__error">{status.message}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
