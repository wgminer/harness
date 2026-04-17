/**
 * Writing surface — minimal first-draft renderer.
 *
 * Shows a single persisted markdown document, separate from chat.
 * - textarea on the left for editing the raw markdown
 * - rendered preview on the right
 * - explicit Save (keyboard: ⌘/Ctrl+S) — the textarea does not auto-persist
 * - Reload pulls from disk, discarding local edits
 * - When a tool call writes to the doc (via doc_write / doc_append), the
 *   saved `updatedAt` changes on disk; we re-read whenever the view is
 *   re-mounted (via App's key) and expose a manual Reload button.
 *
 * Future design session will rework this into something fancier (panels,
 * multiple docs, commit history, inline chat, etc.). Intentionally spartan
 * for now.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { NotebookPen } from "lucide-react";
import { MarkdownContent } from "./chatHelpers";
import { useScrolledHeader } from "./useScrolledHeader";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
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
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const [draft, setDraft] = useState<string>("");
  const [savedContent, setSavedContent] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<number>(0);
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const savedToastTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    void load();
    return () => {
      if (savedToastTimerRef.current != null) {
        window.clearTimeout(savedToastTimerRef.current);
      }
    };
  }, [load]);

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
      savedToastTimerRef.current = window.setTimeout(() => {
        setStatus((s) => (s.kind === "saved" ? { kind: "idle" } : s));
      }, 1500);
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [dirty, draft]);

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
      <header className={`settings-header ${headerScrolled ? "settings-header--scrolled" : ""}`}>
        <div className="settings-header-inner">
          <div className="settings-header-title-row">
            <NotebookPen size={18} />
            <h2 className="settings-title">Writing</h2>
          </div>
          <div className="writing-surface__header-actions">
            <span className="writing-surface__meta" title="Last saved">
              {status.kind === "saving"
                ? "Saving…"
                : status.kind === "saved"
                  ? "Saved"
                  : status.kind === "error"
                    ? `Error: ${status.message}`
                    : dirty
                      ? "Unsaved changes"
                      : `Saved · ${formatUpdatedAt(updatedAt)}`}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => void load()}
              disabled={status.kind === "loading" || status.kind === "saving"}
              title="Reload from disk (discards local edits)"
            >
              Reload
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={!dirty || status.kind === "saving"}
            >
              {status.kind === "saving" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </header>
      <div ref={scrollRef} className="settings-scroll writing-surface__scroll" onScroll={onScroll}>
        <div className="writing-surface__panes">
          <div className="writing-surface__pane writing-surface__pane--editor">
            <textarea
              className="writing-surface__editor"
              data-testid="writing-editor"
              aria-label="Writing surface markdown editor"
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
          <div className="writing-surface__pane writing-surface__pane--preview">
            {draft.trim().length === 0 ? (
              <p className="writing-surface__empty">Preview will appear here.</p>
            ) : (
              <div className="writing-surface__preview">
                <MarkdownContent content={draft} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
