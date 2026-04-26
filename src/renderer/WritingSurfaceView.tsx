import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Save, Trash2 } from "lucide-react";
import type { WritingNoteSummary } from "../shared/writing";

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

export function WritingSurfaceView() {
  const [notes, setNotes] = useState<WritingNoteSummary[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [savedDraft, setSavedDraft] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const savedToastTimerRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) ?? null,
    [activeNoteId, notes],
  );
  const writingApi = window.electron.writing;

  const loadNotes = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      const list = await writingApi.listNotes();
      setNotes(list);
      if (list.length === 0) {
        const created = await writingApi.createNote();
        setNotes([{ id: created.id, title: created.title, updatedAt: created.updatedAt, createdAt: created.createdAt }]);
        setActiveNoteId(created.id);
        setDraft(created.content);
        setSavedDraft(created.content);
        setUpdatedAt(created.updatedAt);
      } else {
        setActiveNoteId((prev) => prev ?? list[0].id);
      }
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, []);

  const loadActiveNote = useCallback(async (id: string) => {
    try {
      const note = await writingApi.readNote(id);
      if (!note) {
        setStatus({ kind: "error", message: "Note not found" });
        return;
      }
      setActiveNoteId(note.id);
      setDraft(note.content);
      setSavedDraft(note.content);
      setUpdatedAt(note.updatedAt);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [writingApi]);

  useEffect(() => {
    void loadNotes();
    return () => {
      if (savedToastTimerRef.current != null) {
        window.clearTimeout(savedToastTimerRef.current);
      }
    };
  }, [loadNotes]);

  useEffect(() => {
    if (!activeNoteId) return;
    void loadActiveNote(activeNoteId);
  }, [activeNoteId, loadActiveNote]);

  const dirty = draft !== savedDraft;

  const save = useCallback(async () => {
    if (!dirty || !activeNoteId) return;
    setStatus({ kind: "saving" });
    try {
      const note = await writingApi.saveNote(activeNoteId, draft);
      setDraft(note.content);
      setSavedDraft(note.content);
      setUpdatedAt(note.updatedAt);
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
  }, [activeNoteId, dirty, draft, writingApi]);

  const createNote = useCallback(async () => {
    setStatus({ kind: "creating" });
    try {
      const note = await writingApi.createNote();
      const summary = { id: note.id, title: note.title, updatedAt: note.updatedAt, createdAt: note.createdAt };
      setNotes((prev) => [summary, ...prev].sort((a, b) => b.updatedAt - a.updatedAt));
      setActiveNoteId(note.id);
      setDraft(note.content);
      setSavedDraft(note.content);
      setUpdatedAt(note.updatedAt);
      setStatus({ kind: "idle" });
      editorRef.current?.focus();
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [writingApi]);

  const deleteActiveNote = useCallback(async () => {
    if (!activeNoteId) return;
    setStatus({ kind: "deleting" });
    try {
      const next = await writingApi.deleteNote(activeNoteId);
      setNotes(next);
      if (next.length === 0) {
        const created = await writingApi.createNote();
        const summary = { id: created.id, title: created.title, updatedAt: created.updatedAt, createdAt: created.createdAt };
        setNotes([summary]);
        setActiveNoteId(created.id);
        setDraft(created.content);
        setSavedDraft(created.content);
        setUpdatedAt(created.updatedAt);
      } else {
        setActiveNoteId(next[0].id);
      }
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [activeNoteId, writingApi]);

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
    <div className="settings-page writing-surface">
      <div className="settings-scroll writing-surface__scroll">
        <div className="writing-surface__workspace">
          <aside className="writing-surface__sidebar" aria-label="Notes list">
            <div className="writing-surface__sidebar-header">
              <button
                type="button"
                className="btn btn-primary writing-surface__new-note"
                onClick={() => void createNote()}
                disabled={status.kind === "creating" || status.kind === "saving" || status.kind === "deleting"}
              >
                <Plus size={14} />
                New note
              </button>
            </div>
            <ul className="writing-surface__notes">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className={`writing-surface__note-item${note.id === activeNoteId ? " is-active" : ""}`}
                    onClick={() => setActiveNoteId(note.id)}
                  >
                    <span className="writing-surface__note-title">{note.title}</span>
                    <span className="writing-surface__note-time">{formatUpdatedAt(note.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className="writing-surface__editor-pane">
            <div className="writing-surface__toolbar">
              <div className="writing-surface__meta">
                <strong>{activeNote?.title ?? "Note"}</strong>
                <span>Last saved: {formatUpdatedAt(updatedAt)}</span>
              </div>
              <button
                type="button"
                className="btn btn-icon"
                onClick={() => void deleteActiveNote()}
                disabled={!activeNoteId || status.kind === "saving" || status.kind === "deleting"}
                aria-label="Delete current note"
                title="Delete note"
              >
                <Trash2 size={16} />
              </button>
              <button
                type="button"
                className="btn btn-primary writing-surface__save-btn"
                onClick={() => void save()}
                disabled={!dirty || status.kind === "saving" || !activeNoteId}
              >
                <Save size={14} />
                {status.kind === "saving" ? "Saving..." : "Save"}
              </button>
            </div>
            <textarea
              ref={editorRef}
              className="writing-surface__editor"
              data-testid="writing-editor"
              aria-label="Desk note editor"
              placeholder={status.kind === "loading" ? "Loading..." : "Write your note here..."}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck
            />
            {status.kind === "error" ? <p className="writing-surface__error">{status.message}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
