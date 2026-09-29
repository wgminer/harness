import { useCallback, useEffect, useRef, useState } from "react";
import { FilePlus2, FolderOpen } from "lucide-react";
import { isFileConflictError, isMarkdownPath, type TextFile } from "../../shared/files";
import { NotesCodeEditor } from "./NotesCodeEditor";
import { NoteConflictBar } from "./NoteConflictBar";

const AUTO_SAVE_DEBOUNCE_MS = 800;
/** How often to look for edits made by other apps while the window is open. */
const DISK_POLL_MS = 2000;

type SaveState = "idle" | "saving" | "saved" | "error";

/** Standalone editor for a file on disk, opened with `harness <path>` or Finder. */
export function FileWindowView({ path }: { path: string }) {
  const [file, setFile] = useState<TextFile | null>(null);
  const [draft, setDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<TextFile | null>(null);
  const [missing, setMissing] = useState(false);
  const [importedNoteId, setImportedNoteId] = useState<string | null>(null);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savedContentRef = useRef("");
  const baseModifiedRef = useRef<number | null>(null);
  const savingRef = useRef(false);
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;
  const autoSaveTimerRef = useRef<number | null>(null);

  const applyFile = useCallback((next: TextFile) => {
    baseModifiedRef.current = next.modifiedMs;
    savedContentRef.current = next.content;
    setFile(next);
    setDraft(next.content);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void window.harness.files
      .readText(path)
      .then((loaded) => {
        if (!cancelled) applyFile(loaded);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path, applyFile]);

  /** Pick up edits from other apps: reload when clean, raise a conflict when dirty. */
  const checkDisk = useCallback(async () => {
    if (savingRef.current || baseModifiedRef.current == null) return;
    const modified = await window.harness.files.stat(path).catch(() => undefined);
    if (modified === undefined) return;
    setMissing(modified === null);
    if (modified === null || modified === baseModifiedRef.current) return;
    const latest = await window.harness.files.readText(path).catch(() => null);
    if (!latest) return;
    if (latest.content === savedContentRef.current) {
      baseModifiedRef.current = latest.modifiedMs;
      return;
    }
    if (draftRef.current === savedContentRef.current) {
      applyFile(latest);
      setConflict(null);
      return;
    }
    setConflict(latest);
  }, [path, applyFile]);

  useEffect(() => {
    const onFocus = () => void checkDisk();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void checkDisk();
    }, DISK_POLL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [checkDisk]);

  const persist = useCallback(
    async (content: string) => {
      if (content === savedContentRef.current || conflictRef.current) return;
      savingRef.current = true;
      setSaveState("saving");
      try {
        const modified = await window.harness.files.saveText(path, content, {
          expectedModifiedMs: missing ? undefined : (baseModifiedRef.current ?? undefined),
        });
        baseModifiedRef.current = modified;
        savedContentRef.current = content;
        setMissing(false);
        setSaveError(null);
        setSaveState("saved");
      } catch (err) {
        if (isFileConflictError(err)) {
          setSaveState("idle");
          savingRef.current = false;
          void checkDisk();
          return;
        }
        setSaveError(String(err));
        setSaveState("error");
      } finally {
        savingRef.current = false;
      }
    },
    [path, missing, checkDisk],
  );

  const handleChange = useCallback(
    (value: string) => {
      setDraft(value);
      if (autoSaveTimerRef.current != null) window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = window.setTimeout(() => {
        autoSaveTimerRef.current = null;
        void persist(value);
      }, AUTO_SAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  // Cmd/Ctrl+S saves now; flush pending edits when the window closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (autoSaveTimerRef.current != null) window.clearTimeout(autoSaveTimerRef.current);
        void persist(draftRef.current);
      }
    };
    const onUnload = () => {
      if (draftRef.current !== savedContentRef.current && !conflictRef.current) {
        void window.harness.files.saveText(path, draftRef.current).catch(() => {});
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [path, persist]);

  const reloadFromDisk = useCallback(() => {
    if (!conflict) return;
    applyFile(conflict);
    setConflict(null);
  }, [conflict, applyFile]);

  const keepMine = useCallback(() => {
    if (!conflict) return;
    baseModifiedRef.current = conflict.modifiedMs;
    setConflict(null);
    conflictRef.current = null;
    void persist(draftRef.current);
  }, [conflict, persist]);

  const saveAsNote = useCallback(async () => {
    if (importedNoteId) {
      await window.harness.notes.popInSticky(importedNoteId);
      return;
    }
    try {
      if (draftRef.current !== savedContentRef.current) await persist(draftRef.current);
      const note = await window.harness.files.importAsNote(path);
      setImportedNoteId(note.id);
    } catch (err) {
      setSaveError(String(err));
    }
  }, [importedNoteId, path, persist]);

  if (loadError) {
    return (
      <div className="windowed-note" data-testid="file-window-error">
        <p className="windowed-note__status windowed-note__status--error">{loadError}</p>
      </div>
    );
  }
  if (!file) {
    return (
      <div className="windowed-note" data-testid="file-window-loading">
        <p className="windowed-note__status">Loading…</p>
      </div>
    );
  }

  const slash = file.path.lastIndexOf("/");
  const folder = slash > 0 ? file.path.slice(0, slash + 1).replace(/^\/Users\/[^/]+\//, "~/") : "";
  const dirty = draft !== savedContentRef.current;
  const statusLabel = missing
    ? "Deleted on disk"
    : saveState === "error"
      ? "Not saved"
      : dirty || saveState === "saving"
        ? "Editing"
        : saveState === "saved"
          ? "Saved"
          : "";

  return (
    <div className="windowed-note file-window" data-testid="file-window">
      <header className="file-window__header">
        <span className="file-window__path" title={file.path}>
          <span className="file-window__folder">{folder}</span>
          <span className="file-window__name">{file.name}</span>
        </span>
        {statusLabel ? <span className="file-window__status">{statusLabel}</span> : null}
        <button
          type="button"
          className="btn btn-icon windowed-note__action"
          onClick={() => void window.harness.system.showInFolder(file.path)}
          aria-label="Show in Finder"
          title="Show in Finder"
        >
          <FolderOpen size={14} aria-hidden />
        </button>
        {isMarkdownPath(file.path) ? (
          <button
            type="button"
            className="btn btn-sm file-window__save-note"
            onClick={() => void saveAsNote()}
            title={
              importedNoteId
                ? "Open the note in Harness"
                : "Copy this file into your Harness notes"
            }
          >
            <FilePlus2 size={14} aria-hidden />
            <span>{importedNoteId ? "Open note" : "Save as note"}</span>
          </button>
        ) : null}
      </header>
      {conflict ? (
        <NoteConflictBar
          message="This file changed on disk."
          onReload={reloadFromDisk}
          onKeepMine={keepMine}
        />
      ) : null}
      <div className="windowed-note__editor-wrap">
        <NotesCodeEditor
          className="windowed-note__editor notes-code-editor"
          data-testid="file-window-editor"
          aria-label={file.name}
          placeholder="Empty file"
          value={draft}
          onChange={handleChange}
        />
      </div>
      {saveError ? <p className="windowed-note__inline-error">{saveError}</p> : null}
    </div>
  );
}
