import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, History, PanelRightClose, PanelRightOpen, Redo2, RotateCcw, Trash2, Undo2 } from "lucide-react";
import { MAX_WRITING_CHECKPOINTS } from "../shared/writing";
import { MarkdownContent } from "./chatHelpers";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "error"; message: string };

type SaveHistoryEntry = { id: string; content: string; createdAt: number };

function isMissingCheckpointListHandler(error: unknown): boolean {
  return String(error).includes("No handler registered for 'writing:checkpoints:list'");
}

function formatUpdatedAt(ms: number): string {
  if (!ms) return "Never";
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function summarizeSave(content: string): string {
  const firstLine = content
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "(empty)";
  return firstLine.length > 72 ? `${firstLine.slice(0, 72).trimEnd()}...` : firstLine;
}

export function WritingSurfaceView() {
  const [draft, setDraft] = useState<string>("");
  const [savedContent, setSavedContent] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saveHistory, setSaveHistory] = useState<SaveHistoryEntry[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [previewMode, setPreviewMode] = useState<"split" | "hidden">("hidden");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const savedToastTimerRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    setStatus({ kind: "loading" });
    try {
      const snap = await window.electron.writing.read();
      setDraft(snap.content);
      setSavedContent(snap.content);
      setUpdatedAt(snap.updatedAt);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, []);

  const loadSaveHistory = useCallback(async () => {
    try {
      const list = await window.electron.writing.listCheckpoints();
      setSaveHistory(list);
    } catch (e) {
      // During dev/hot-reload or partial upgrades, checkpoint IPC can be missing.
      // Saving the desk doc should still work; we just hide history in that case.
      if (isMissingCheckpointListHandler(e)) {
        setSaveHistory([]);
        return;
      }
      setStatus({ kind: "error", message: String(e) });
    }
  }, []);

  useEffect(() => {
    void load();
    void loadSaveHistory();
    return () => {
      if (savedToastTimerRef.current != null) {
        window.clearTimeout(savedToastTimerRef.current);
      }
    };
  }, [load, loadSaveHistory]);

  const dirty = draft !== savedContent;

  const save = useCallback(async () => {
    if (!dirty) return;
    setStatus({ kind: "saving" });
    try {
      const snap = await window.electron.writing.write(draft);
      setSavedContent(snap.content);
      setUpdatedAt(snap.updatedAt);
      // Keep draft in sync (write() normalizes \r\n → \n, so reflect that).
      if (snap.content !== draft) setDraft(snap.content);
      setStatus({ kind: "saved", at: snap.updatedAt });
      if (savedToastTimerRef.current != null) {
        window.clearTimeout(savedToastTimerRef.current);
      }
      void loadSaveHistory();
      savedToastTimerRef.current = window.setTimeout(() => {
        setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
      }, 1500);
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [dirty, draft, loadSaveHistory]);

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

  const restoreSave = useCallback((content: string) => {
    setDraft(content);
    setStatus({ kind: "idle" });
  }, []);

  const deleteSave = useCallback(async (id: string) => {
    setHistoryBusy(true);
    try {
      const list = await window.electron.writing.deleteCheckpoint(id);
      setSaveHistory(list);
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    } finally {
      setHistoryBusy(false);
    }
  }, []);

  const triggerEditorHistory = useCallback((direction: "undo" | "redo") => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(direction);
  }, []);

  return (
    <div className="settings-page writing-surface">
      <div className="settings-scroll writing-surface__scroll">
        <div className={`writing-surface__workspace${historyOpen ? " writing-surface__workspace--history-open" : ""}`}>
          <div className={`writing-surface__panes writing-surface__panes--${previewMode}`}>
            <div className="writing-surface__floating-actions">
              <button
                type="button"
                className="btn btn-icon writing-surface__floating-btn"
                onClick={() => triggerEditorHistory("undo")}
                aria-label="Undo"
                title="Undo"
              >
                <Undo2 size={18} />
              </button>
              <button
                type="button"
                className="btn btn-icon writing-surface__floating-btn"
                onClick={() => triggerEditorHistory("redo")}
                aria-label="Redo"
                title="Redo"
              >
                <Redo2 size={18} />
              </button>
              <button
                type="button"
                className={`btn btn-icon writing-surface__floating-btn${previewMode === "split" ? " btn-primary" : ""}`}
                onClick={() => setPreviewMode((mode) => (mode === "split" ? "hidden" : "split"))}
                aria-pressed={previewMode === "split"}
                aria-label={previewMode === "split" ? "Hide side-by-side preview" : "Show side-by-side preview"}
                title={previewMode === "split" ? "Hide side-by-side preview" : "Show side-by-side preview"}
              >
                {previewMode === "split" ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
              <button
                type="button"
                className={`btn btn-icon writing-surface__floating-btn${historyOpen ? " btn-primary" : ""}`}
                onClick={() => setHistoryOpen((v) => !v)}
                aria-pressed={historyOpen}
                aria-label={historyOpen ? "Close save history panel" : "Open save history panel"}
                title={historyOpen ? "Close save history panel" : "Open save history panel"}
              >
                {historyOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
              </button>
              <button
                type="button"
                className="btn btn-primary writing-surface__save-btn"
                onClick={() => void save()}
                disabled={!dirty || status.kind === "saving"}
              >
                {status.kind === "saving" ? "Saving…" : "Save"}
              </button>
            </div>
            <div className="writing-surface__pane writing-surface__pane--editor">
              <textarea
                ref={editorRef}
                className="writing-surface__editor"
                data-testid="writing-editor"
                aria-label="Desk markdown editor"
                placeholder={
                  status.kind === "loading"
                    ? "Loading…"
                    : "Write markdown here. The assistant can read and update this doc via the doc_* tools."
                }
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck
              />
            </div>
            {previewMode === "split" ? (
              <div className="writing-surface__pane writing-surface__pane--preview">
                {draft.trim().length === 0 ? (
                  <p className="writing-surface__empty">Preview will appear here.</p>
                ) : (
                  <div className="writing-surface__preview">
                    <MarkdownContent content={draft} />
                  </div>
                )}
              </div>
            ) : null}
          </div>
          {historyOpen ? (
            <aside className="writing-surface__history" aria-label="Save history">
              <div className="writing-surface__history-header">
                <span className="writing-surface__history-title">
                  <History size={14} />
                  Save History
                </span>
                <span className="writing-surface__history-count">
                  {saveHistory.length}/{MAX_WRITING_CHECKPOINTS}
                </span>
              </div>
              {saveHistory.length === 0 ? (
                <p className="writing-surface__history-empty">No saves yet. Save to create history.</p>
              ) : (
                <ul className="writing-surface__history-list">
                  {saveHistory.map((entry) => (
                    <li key={entry.id} className="writing-surface__history-item">
                      <div className="writing-surface__history-main">
                        <div className="writing-surface__history-time">{formatUpdatedAt(entry.createdAt)}</div>
                        <div className="writing-surface__history-summary" title={summarizeSave(entry.content)}>
                          {summarizeSave(entry.content)}
                        </div>
                      </div>
                      <div className="writing-surface__history-actions">
                        <button
                          type="button"
                          className="btn btn-icon"
                          aria-label="Restore this saved version into the editor"
                          title="Restore into editor"
                          onClick={() => restoreSave(entry.content)}
                          disabled={historyBusy || status.kind === "saving"}
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-icon"
                          aria-label="Delete this saved version"
                          title="Delete saved version"
                          onClick={() => void deleteSave(entry.id)}
                          disabled={historyBusy || status.kind === "saving"}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <p className="writing-surface__history-note">
                Restoring loads that version into the editor. Press Save to make it current.
              </p>
            </aside>
          ) : null}
        </div>
      </div>
    </div>
  );
}
