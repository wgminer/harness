import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ArrowRightLeft,
  Check,
  PaintBucket,
  Copy,
  FolderOpen,
  MoreVertical,
  Printer,
  RefreshCw,
  SpellCheck,
  SquareArrowOutUpRight,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  DEFAULT_NOTE_TEMPLATES,
  getDisplayNoteTitle,
  normalizeNoteTemplates,
  resolveNoteTemplateContent,
  type NoteSummary,
  type NoteTemplateConfig,
} from "../shared/writing";
import { buildNotePrintHtml } from "../shared/notePrint";
import { NotesCodeEditor, type NotesCodeEditorHandle } from "./NotesCodeEditor";
import {
  getNotesEditorCaretCoordinates,
  measureNotesEditorLineWidth,
} from "./notesEditorExtensions";
import { useScrolledHeader } from "./useScrolledHeader";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "saving" }
  | { kind: "deleting" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

type AsideStatus = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };

interface SelectionRange {
  start: number;
  end: number;
  text: string;
}

const MIN_REGENERATE_SPIN_MS = 3000;
const ASIDE_PANEL_MEASURE_BUFFER_PX = 120;
const NOTES_SELECTION_TOOLBAR_W_PX = 96;
const NOTES_SELECTION_TOOLBAR_H_PX = 36;
const NOTES_SELECTION_TOOLBAR_GAP_PX = 8;
const NOTES_AUTO_SAVE_DEBOUNCE_MS = 800;
const NOTE_WIDTH_MODES = ["narrow", "comfortable"] as const;
type NoteWidthMode = (typeof NOTE_WIDTH_MODES)[number];
const NOTE_WIDTH_LABELS: Record<NoteWidthMode, string> = {
  narrow: "100%",
  comfortable: "640px",
};

function measureLongestSelectedLineWidth(view: NonNullable<ReturnType<NotesCodeEditorHandle["getView"]>>, selectedText: string): number {
  const normalized = selectedText.replace(/\r/g, "");
  if (!normalized) return 0;
  const lines = normalized.split("\n");
  let maxWidth = 0;
  for (const line of lines) {
    const measured = measureNotesEditorLineWidth(view, line);
    if (measured > maxWidth) {
      maxWidth = measured;
    }
  }
  return maxWidth;
}

interface NotesViewProps {
  notes: NoteSummary[];
  onNotesChange: Dispatch<SetStateAction<NoteSummary[]>>;
  initialOpenNoteId?: string | null;
  initialOpenNoteRequestNonce?: number;
  /** True when initialOpenNoteId is a just-created, untouched note — shows the inline template picker. */
  initialOpenNoteIsNew?: boolean;
  onInitialOpenNoteHandled?: () => void;
  onActiveNoteChange?: (noteId: string | null) => void;
}

export function NotesView({
  notes,
  onNotesChange: setNotes,
  initialOpenNoteId,
  initialOpenNoteRequestNonce,
  initialOpenNoteIsNew,
  onInitialOpenNoteHandled,
  onActiveNoteChange,
}: NotesViewProps) {
  const { scrollRef, onScroll } = useScrolledHeader();
  const [noteTemplates, setNoteTemplates] = useState<NoteTemplateConfig[]>(
    DEFAULT_NOTE_TEMPLATES.map((template) => ({ ...template })),
  );
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [isFreshNote, setIsFreshNote] = useState(false);
  const [draft, setDraft] = useState<string>("");
  const [savedDraft, setSavedDraft] = useState<string>("");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [panelPrompt, setPanelPrompt] = useState<string>("");
  const [panelOutput, setPanelOutput] = useState<string>("");
  const [asideStatus, setAsideStatus] = useState<AsideStatus>({ kind: "idle" });
  const [asidePosition, setAsidePosition] = useState<{ top: number; left: number; width: number }>({
    top: 24,
    left: 24,
    width: 240,
  });
  const [toolbarPosition, setToolbarPosition] = useState<{ top: number; left: number }>({ top: 24, left: 24 });
  const [asideExpanded, setAsideExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [spellCheckLoading, setSpellCheckLoading] = useState(false);
  const [noteWidthMode, setNoteWidthMode] = useState<NoteWidthMode>("comfortable");
  const [noteToolbarMenuOpen, setNoteToolbarMenuOpen] = useState(false);
  const savedToastTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const noteToolbarMenuRef = useRef<HTMLDivElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<NotesCodeEditorHandle | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement | null>(null);
  const asidePanelRef = useRef<HTMLElement | null>(null);
  const pendingEditorFocusRef = useRef(false);
  const pendingEditorCaretRef = useRef<number | null>(null);

  const scheduleEditorFocus = useCallback((caret?: number) => {
    pendingEditorFocusRef.current = true;
    pendingEditorCaretRef.current = caret ?? null;
  }, []);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [selectedNoteId, notes],
  );
  const notesApi = window.harness.notes;
  const hasSelection = selection != null;
  const showSelectionToolbar = hasSelection && !asideExpanded;
  const showAsidePanel = hasSelection && asideExpanded;

  const closeAsidePanel = useCallback(() => {
    setAsideExpanded(false);
    setSelection(null);
    setPanelPrompt("");
    setPanelOutput("");
    setAsideStatus({ kind: "idle" });
    setCopyFeedback(false);
    if (copyFeedbackTimerRef.current != null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
      copyFeedbackTimerRef.current = null;
    }
  }, []);

  const resetToEmptyState = useCallback(() => {
    closeAsidePanel();
    setSelectedNoteId(null);
    setDraft("");
    setSavedDraft("");
    setIsFreshNote(false);
  }, [closeAsidePanel]);

  // Sidebar (or another surface) may delete the open note — clear the editor.
  useEffect(() => {
    if (!selectedNoteId) return;
    if (notes.some((note) => note.id === selectedNoteId)) return;
    resetToEmptyState();
    setStatus({ kind: "idle" });
  }, [notes, resetToEmptyState, selectedNoteId]);

  const updateAsidePosition = useCallback((range: SelectionRange | null) => {
    const view = editorRef.current?.getView();
    if (!view || !range) return;
    const startCoords = getNotesEditorCaretCoordinates(view, range.start);
    const endCoords = getNotesEditorCaretCoordinates(view, range.end);
    if (!startCoords || !endCoords) return;
    const startLine = view.state.doc.lineAt(range.start).number;
    const endLine = view.state.doc.lineAt(range.end).number;
    const sameLine = startLine === endLine;
    const longestLineWidth = measureLongestSelectedLineWidth(view, range.text);
    const highlightedWidth = sameLine
      ? Math.max(260, endCoords.left - startCoords.left + ASIDE_PANEL_MEASURE_BUFFER_PX)
      : Math.max(300, longestLineWidth + ASIDE_PANEL_MEASURE_BUFFER_PX);
    const panelWidth = Math.min(620, Math.max(180, highlightedWidth));
    const rawLeft = startCoords.left - 12;
    const rawTop = endCoords.bottom + 10;
    const maxLeft = Math.max(12, view.dom.clientWidth - panelWidth - 12);
    const maxTop = Math.max(12, view.dom.clientHeight - 180);
    setAsidePosition({
      left: Math.max(12, Math.min(rawLeft, maxLeft)),
      top: Math.max(12, Math.min(rawTop, maxTop)),
      width: panelWidth,
    });
  }, []);

  const updateToolbarPosition = useCallback((range: SelectionRange | null) => {
    const view = editorRef.current?.getView();
    if (!view || !range) return;
    const endCoords = getNotesEditorCaretCoordinates(view, range.end);
    if (!endCoords) return;
    const belowTop = endCoords.bottom + NOTES_SELECTION_TOOLBAR_GAP_PX;
    const top = Math.max(12, Math.min(belowTop, view.dom.clientHeight - NOTES_SELECTION_TOOLBAR_H_PX - 12));
    const rawLeft = endCoords.left - NOTES_SELECTION_TOOLBAR_W_PX + 4;
    const maxLeft = Math.max(12, view.dom.clientWidth - NOTES_SELECTION_TOOLBAR_W_PX - 12);
    setToolbarPosition({
      top,
      left: Math.max(12, Math.min(rawLeft, maxLeft)),
    });
  }, []);

  const updateSelectionState = useCallback(() => {
    const view = editorRef.current?.getView();
    if (!view) {
      closeAsidePanel();
      return;
    }
    const { from, to } = view.state.selection.main;
    if (from === to) {
      closeAsidePanel();
      return;
    }
    const selectionStart = Math.min(from, to);
    const selectionEnd = Math.max(from, to);
    const selectedText = view.state.sliceDoc(selectionStart, selectionEnd);
    if (!selectedText.trim()) {
      closeAsidePanel();
      return;
    }
    setSelection((prev) => {
      if (prev && prev.start === selectionStart && prev.end === selectionEnd && prev.text === selectedText) {
        return prev;
      }
      if (prev) setAsideExpanded(false);
      return { start: selectionStart, end: selectionEnd, text: selectedText };
    });
    setPanelPrompt((prev) => {
      const prevSelection =
        selection != null ? draft.slice(selection.start, selection.end) : null;
      const selectionChanged = prevSelection !== selectedText;
      return selectionChanged ? "" : prev;
    });
    setPanelOutput((prev) => {
      const prevSelection =
        selection != null ? draft.slice(selection.start, selection.end) : null;
      const selectionChanged = prevSelection !== selectedText;
      return selectionChanged ? "" : prev;
    });
    setAsideStatus({ kind: "idle" });
    const range = { start: selectionStart, end: selectionEnd, text: selectedText };
    updateAsidePosition(range);
    updateToolbarPosition(range);
  }, [closeAsidePanel, draft, selection, updateAsidePosition, updateToolbarPosition]);

  const loadActiveNote = useCallback(async (id: string) => {
    try {
      const note = await notesApi.read(id);
      if (!note) {
        setStatus({ kind: "error", message: "Note not found" });
        return;
      }
      setNotes((prev) => {
        const summary = {
          id: note.id,
          title: note.title,
          updatedAt: note.updatedAt,
          createdAt: note.createdAt,
          wordCount: note.wordCount,
        };
        const next = prev.some((item) => item.id === note.id)
          ? prev.map((item) => (item.id === note.id ? summary : item))
          : [summary, ...prev];
        return next.sort((a, b) => b.updatedAt - a.updatedAt);
      });
      setSelectedNoteId(note.id);
      setDraft(note.content);
      setSavedDraft(note.content);
      closeAsidePanel();
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [closeAsidePanel, notesApi, setNotes]);

  useEffect(() => {
    void window.harness.settings
      .get()
      .then((settings) => {
        setNoteTemplates(normalizeNoteTemplates((settings as { notes?: { templates?: unknown } }).notes?.templates));
      })
      .catch(() => {
        setNoteTemplates(DEFAULT_NOTE_TEMPLATES.map((template) => ({ ...template })));
      });
    return () => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      if (savedToastTimerRef.current != null) {
        window.clearTimeout(savedToastTimerRef.current);
      }
      if (copyFeedbackTimerRef.current != null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const onTemplatesUpdated = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      setNoteTemplates(normalizeNoteTemplates(detail));
    };
    window.addEventListener("notes:templatesUpdated", onTemplatesUpdated);
    return () => window.removeEventListener("notes:templatesUpdated", onTemplatesUpdated);
  }, []);

  useEffect(() => {
    if (!initialOpenNoteId) return;
    let cancelled = false;
    const openInitialNote = async () => {
      scheduleEditorFocus();
      setStatus({ kind: "loading" });
      await loadActiveNote(initialOpenNoteId);
      if (!cancelled) {
        setIsFreshNote(!!initialOpenNoteIsNew);
        onInitialOpenNoteHandled?.();
      }
    };
    void openInitialNote();
    return () => {
      cancelled = true;
      pendingEditorFocusRef.current = false;
      pendingEditorCaretRef.current = null;
    };
  }, [
    initialOpenNoteId,
    initialOpenNoteIsNew,
    initialOpenNoteRequestNonce,
    loadActiveNote,
    onInitialOpenNoteHandled,
    scheduleEditorFocus,
  ]);

  useEffect(() => {
    onActiveNoteChange?.(selectedNoteId);
  }, [onActiveNoteChange, selectedNoteId]);

  useEffect(() => {
    if (!pendingEditorFocusRef.current) return;
    if (status.kind === "loading" || status.kind === "deleting") return;
    if (status.kind === "error") {
      pendingEditorFocusRef.current = false;
      pendingEditorCaretRef.current = null;
      return;
    }
    pendingEditorFocusRef.current = false;
    const caret = pendingEditorCaretRef.current;
    pendingEditorCaretRef.current = null;
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      if (caret != null) {
        editorRef.current?.setSelection(caret, caret);
      }
    });
  }, [selectedNoteId, status.kind]);

  useEffect(() => {
    if (!noteToolbarMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNoteToolbarMenuOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      const el = noteToolbarMenuRef.current;
      if (el && !el.contains(e.target as Node)) setNoteToolbarMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [noteToolbarMenuOpen]);

  const dirty = draft !== savedDraft;

  useEffect(() => {
    if (dirty) setIsFreshNote(false);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!dirty || !selectedNoteId) return;
    setStatus({ kind: "saving" });
    try {
      const note = await notesApi.save(selectedNoteId, draft);
      setDraft(note.content);
      setSavedDraft(note.content);
      setNotes((prev) =>
        prev
          .map((item) =>
            item.id === note.id ? { ...item, title: note.title, updatedAt: note.updatedAt, wordCount: note.wordCount } : item,
          )
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
  }, [selectedNoteId, dirty, draft, notesApi, setNotes]);

  const applyTemplate = useCallback(
    (template: NoteTemplateConfig) => {
      const { content, cursorOffset } = resolveNoteTemplateContent(template.content);
      setDraft(content);
      const caret = Math.max(0, Math.min(cursorOffset ?? content.length, content.length));
      scheduleEditorFocus(caret);
    },
    [scheduleEditorFocus],
  );

  const deleteActiveNote = useCallback(async () => {
    if (!selectedNoteId) return;
    setStatus({ kind: "deleting" });
    try {
      const next = await notesApi.delete(selectedNoteId);
      setNotes(next);
      resetToEmptyState();
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [selectedNoteId, resetToEmptyState, notesApi, setNotes]);

  const openInNewWindow = useCallback(async () => {
    if (!selectedNoteId || status.kind === "deleting") return;
    setNoteToolbarMenuOpen(false);
    try {
      if (dirty) {
        await save();
      }
      await window.harness.notes.openSticky(selectedNoteId);
      resetToEmptyState();
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [dirty, resetToEmptyState, save, selectedNoteId, status.kind]);

  const cycleNoteWidthMode = useCallback(() => {
    setNoteWidthMode((prev) => {
      const idx = NOTE_WIDTH_MODES.indexOf(prev);
      return NOTE_WIDTH_MODES[(idx + 1) % NOTE_WIDTH_MODES.length];
    });
  }, []);

  const regenerateAside = useCallback(async () => {
    if (!selection) return;
    const prompt = panelPrompt.trim();
    if (!prompt) {
      setAsideStatus({ kind: "error", message: "Enter a prompt first." });
      return;
    }
    setAsideStatus({ kind: "loading" });
    const loadingStartedAt = performance.now();
    const activeElement = document.activeElement as HTMLElement | null;
    try {
      const response = await notesApi.proposeEdit({
        selectedText: selection.text,
        prompt,
        beforeText: draft.slice(0, selection.start),
        afterText: draft.slice(selection.end),
        documentText: draft,
      });
      setPanelOutput(response.proposedText);
      const elapsed = performance.now() - loadingStartedAt;
      const remaining = Math.max(0, MIN_REGENERATE_SPIN_MS - elapsed);
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      activeElement?.focus();
      setAsideStatus({ kind: "idle" });
    } catch (e) {
      const elapsed = performance.now() - loadingStartedAt;
      const remaining = Math.max(0, MIN_REGENERATE_SPIN_MS - elapsed);
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      activeElement?.focus();
      setAsideStatus({ kind: "error", message: String(e) });
    }
  }, [selection, panelPrompt, notesApi, draft]);

  const approveAside = useCallback(() => {
    if (!selection) return;
    const currentSlice = draft.slice(selection.start, selection.end);
    if (currentSlice !== selection.text) {
      closeAsidePanel();
      return;
    }
    const insertionStart = selection.start;
    setDraft((prev) => prev.slice(0, selection.start) + panelOutput + prev.slice(selection.end));
    closeAsidePanel();
    requestAnimationFrame(() => {
      editorRef.current?.focus();
      editorRef.current?.setSelection(insertionStart, insertionStart);
    });
  }, [selection, draft, panelOutput, closeAsidePanel]);

  const dismissAside = useCallback(() => {
    closeAsidePanel();
    requestAnimationFrame(() => {
      const view = editorRef.current?.getView();
      const caret = view?.state.selection.main.head ?? 0;
      editorRef.current?.focus();
      editorRef.current?.setSelection(caret, caret);
    });
  }, [closeAsidePanel]);

  const handleCopySelection = useCallback(async () => {
    if (!selection) return;
    try {
      await navigator.clipboard.writeText(selection.text);
      setCopyFeedback(true);
      if (copyFeedbackTimerRef.current != null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopyFeedback(false);
        copyFeedbackTimerRef.current = null;
      }, 2000);
    } catch {
      /* ignore */
    }
  }, [selection]);

  const handleSpellCheckSelection = useCallback(async () => {
    if (!selection || spellCheckLoading) return;
    const { start, end, text } = selection;
    setSpellCheckLoading(true);
    try {
      const response = await notesApi.spellCheck({
        selectedText: text,
        beforeText: draft.slice(0, start),
        afterText: draft.slice(end),
        documentText: draft,
      });
      const currentSlice = draft.slice(start, end);
      if (currentSlice !== text) return;
      setDraft((prev) => prev.slice(0, start) + response.proposedText + prev.slice(end));
      setSelection(null);
      requestAnimationFrame(() => {
        const caret = start + response.proposedText.length;
        editorRef.current?.focus();
        editorRef.current?.setSelection(caret, caret);
      });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    } finally {
      setSpellCheckLoading(false);
    }
  }, [selection, spellCheckLoading, draft, notesApi]);

  const openAiAside = useCallback(() => {
    if (!selection) return;
    setAsideExpanded(true);
    requestAnimationFrame(() => {
      updateAsidePosition(selection);
      promptRef.current?.focus();
    });
  }, [selection, updateAsidePosition]);

  const handleEditorScroll = useCallback(() => {
    if (!selection) return;
    updateAsidePosition(selection);
    updateToolbarPosition(selection);
  }, [selection, updateAsidePosition, updateToolbarPosition]);

  const previewRows = useMemo(() => {
    const source = (panelOutput || selection?.text || "").replace(/\r/g, "");
    if (!source) return 2;
    const lines = source.split("\n");
    const estimated = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 68)), 0);
    return Math.max(2, Math.min(14, estimated));
  }, [panelOutput, selection]);

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

  useEffect(() => {
    if (autoSaveTimerRef.current != null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (!dirty || !selectedNoteId || status.kind === "loading" || status.kind === "deleting") {
      return;
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      void save();
    }, NOTES_AUTO_SAVE_DEBOUNCE_MS);
    return () => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [dirty, save, selectedNoteId, status.kind]);

  useEffect(() => {
    if (!selection) return;
    requestAnimationFrame(() => {
      updateAsidePosition(selection);
      updateToolbarPosition(selection);
    });
  }, [selection, asideExpanded, updateAsidePosition, updateToolbarPosition]);

  useEffect(() => {
    if (!showSelectionToolbar) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (selectionToolbarRef.current?.contains(t)) return;
      if (editorRef.current?.getView()?.dom.contains(t)) return;
      dismissAside();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [showSelectionToolbar, dismissAside]);

  useEffect(() => {
    if (!asideExpanded) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (asidePanelRef.current?.contains(t)) return;
      dismissAside();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [asideExpanded, dismissAside]);

  const showInlineTemplates = isFreshNote && !dirty;

  return (
    <div className="workspace-page notes-surface">
      <div
        ref={scrollRef}
        className="workspace-scroll notes-surface__scroll notes-surface__scroll--detail"
        onScroll={onScroll}
      >
        <section className="notes-surface__detail">
          {selectedNoteId == null && status.kind !== "loading" ? (
            <div className="notes-surface__empty-state">
              <p className="notes-surface__empty">Select a note from the sidebar.</p>
            </div>
          ) : (
            <>
              <div className="notes-surface__toolbar">
                <div className="notes-surface__meta">
                  <strong
                    className="notes-surface__meta-title"
                    title={activeNote ? getDisplayNoteTitle(activeNote.title) : "Note"}
                  >
                    {activeNote ? getDisplayNoteTitle(activeNote.title) : "Note"}
                  </strong>
                </div>
                <div className="notes-surface__toolbar-menu-wrap" ref={noteToolbarMenuRef}>
                  <button
                    type="button"
                    className="btn btn-icon"
                    aria-expanded={noteToolbarMenuOpen}
                    aria-haspopup="menu"
                    aria-label="Note actions"
                    title="More actions"
                    onClick={() => setNoteToolbarMenuOpen((v) => !v)}
                  >
                    <MoreVertical size={16} />
                  </button>
                  {noteToolbarMenuOpen ? (
                    <div className="notes-surface__toolbar-menu" role="menu" aria-label="Note actions">
                      <button
                        type="button"
                        className="notes-surface__toolbar-menu-item"
                        role="menuitem"
                        onClick={() => {
                          cycleNoteWidthMode();
                          setNoteToolbarMenuOpen(false);
                        }}
                      >
                        <ArrowRightLeft size={16} aria-hidden />
                        <span>Text width ({NOTE_WIDTH_LABELS[noteWidthMode]})</span>
                      </button>
                      <button
                        type="button"
                        className="notes-surface__toolbar-menu-item"
                        role="menuitem"
                        disabled={!selectedNoteId || status.kind === "saving" || status.kind === "deleting"}
                        onClick={() => {
                          const title = activeNote ? getDisplayNoteTitle(activeNote.title) : "Note";
                          const html = buildNotePrintHtml(title, draft);
                          void window.harness.notes.print(html, title);
                          setNoteToolbarMenuOpen(false);
                        }}
                      >
                        <Printer size={16} aria-hidden />
                        <span>Print</span>
                      </button>
                      <button
                        type="button"
                        className="notes-surface__toolbar-menu-item"
                        role="menuitem"
                        disabled={!selectedNoteId || status.kind === "saving" || status.kind === "deleting"}
                        onClick={() => {
                          const id = selectedNoteId;
                          if (!id) return;
                          void window.harness.notes.showInFolder(id);
                          setNoteToolbarMenuOpen(false);
                        }}
                      >
                        <FolderOpen size={16} aria-hidden />
                        <span>Show file</span>
                      </button>
                      <button
                        type="button"
                        className="notes-surface__toolbar-menu-item"
                        role="menuitem"
                        data-testid="notes-open-in-new-window"
                        disabled={!selectedNoteId || status.kind === "saving" || status.kind === "deleting"}
                        onClick={() => {
                          void openInNewWindow();
                        }}
                      >
                        <SquareArrowOutUpRight size={16} aria-hidden />
                        <span>Open in new window</span>
                      </button>
                      <button
                        type="button"
                        className="notes-surface__toolbar-menu-item notes-surface__toolbar-menu-item--danger"
                        role="menuitem"
                        disabled={!selectedNoteId || status.kind === "saving" || status.kind === "deleting"}
                        onClick={() => {
                          void deleteActiveNote();
                          setNoteToolbarMenuOpen(false);
                        }}
                      >
                        <Trash2 size={16} aria-hidden />
                        <span>Delete note</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div
                ref={editorWrapRef}
                className={`notes-surface__editor-wrap notes-surface__editor-wrap--${noteWidthMode}`}
              >
                <NotesCodeEditor
                  ref={editorRef}
                  className="notes-surface__editor notes-code-editor"
                  data-testid="notes-editor"
                  aria-label="Editor"
                  placeholder={status.kind === "loading" ? "Loading..." : "Write your note here..."}
                  value={draft}
                  readOnly={status.kind === "loading" || status.kind === "deleting"}
                  onChange={setDraft}
                  onSelectionChange={updateSelectionState}
                  onScroll={handleEditorScroll}
                />
                {showSelectionToolbar ? (
                  <div
                    ref={selectionToolbarRef}
                    className="notes-selection-toolbar"
                    role="toolbar"
                    aria-label="Selection actions"
                    style={{
                      top: `${toolbarPosition.top}px`,
                      left: `${toolbarPosition.left}px`,
                    }}
                  >
                    <button
                      type="button"
                      className="notes-selection-toolbar__btn"
                      aria-label={copyFeedback ? "Copied" : "Copy"}
                      title={copyFeedback ? "Copied!" : "Copy"}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleCopySelection()}
                    >
                      {copyFeedback ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                    </button>
                    <button
                      type="button"
                      className="notes-selection-toolbar__btn"
                      aria-label="Spell check"
                      title="Spell check"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleSpellCheckSelection()}
                      disabled={spellCheckLoading}
                    >
                      {spellCheckLoading ? (
                        <RefreshCw size={16} aria-hidden className="notes-aside-panel__regen-icon--spinning" />
                      ) : (
                        <SpellCheck size={16} aria-hidden />
                      )}
                    </button>
                    <button
                      type="button"
                      className="notes-selection-toolbar__btn"
                      aria-label="AI edit"
                      title="AI edit"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={openAiAside}
                    >
                      <PaintBucket size={16} aria-hidden />
                    </button>
                  </div>
                ) : null}
                {showAsidePanel ? (
                  <section
                    ref={asidePanelRef}
                    className="notes-aside-panel notes-aside-panel--floating"
                    aria-label="Inline edit assistant"
                    style={{
                      top: `${asidePosition.top}px`,
                      left: `${asidePosition.left}px`,
                      width: `${asidePosition.width}px`,
                    }}
                  >
                    <div className="notes-aside-panel__preview notes-aside-panel__input-wrap">
                      <div className="notes-aside-panel__header">
                        <button
                          type="button"
                          className="btn btn-icon-sm notes-aside-panel__close"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={dismissAside}
                          aria-label="Close edit assistant"
                          title="Close"
                        >
                          <X size={12} />
                        </button>
                      </div>
                      <textarea
                        id="notes-aside-output"
                        className="notes-aside-panel__textarea notes-aside-panel__textarea--output"
                        value={panelOutput}
                        onChange={(e) => setPanelOutput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") {
                            e.preventDefault();
                            dismissAside();
                          }
                        }}
                        placeholder={selection?.text || "Generated rewrite appears here..."}
                        rows={previewRows}
                      />
                      {panelOutput.trim() ? (
                        <button
                          type="button"
                          className="btn btn-sm notes-aside-panel__corner-btn notes-aside-panel__corner-btn--approve"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={approveAside}
                        >
                          <PaintBucket size={12} aria-hidden />
                          Replace
                        </button>
                      ) : null}
                    </div>
                    <div className="notes-aside-panel__body">
                      <div className="notes-aside-panel__field">
                        <div className="notes-aside-panel__input-wrap">
                          <textarea
                            ref={promptRef}
                            id="notes-aside-prompt"
                            className="notes-aside-panel__textarea"
                            value={panelPrompt}
                            onChange={(e) => setPanelPrompt(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") {
                                e.preventDefault();
                                dismissAside();
                                return;
                              }
                              const nativeEvent = e.nativeEvent as KeyboardEvent;
                              const isComposing = nativeEvent.isComposing;
                              const hasModifier = e.shiftKey || e.ctrlKey || e.metaKey || e.altKey;
                              if (isComposing || e.repeat) {
                                return;
                              }
                              if (e.key === "Enter" && !hasModifier) {
                                e.preventDefault();
                                if (asideStatus.kind !== "loading") {
                                  void regenerateAside();
                                }
                              }
                            }}
                            rows={3}
                            placeholder="Describe your change"
                          />
                          <button
                            type="button"
                            className="btn btn-sm notes-aside-panel__corner-btn"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => void regenerateAside()}
                            disabled={asideStatus.kind === "loading"}
                          >
                            <RefreshCw
                              size={12}
                              className={
                                asideStatus.kind === "loading" ? "notes-aside-panel__regen-icon--spinning" : undefined
                              }
                            />
                            Generate
                          </button>
                        </div>
                      </div>
                      {asideStatus.kind === "error" ? (
                        <p className="notes-aside-panel__error">{asideStatus.message}</p>
                      ) : null}
                    </div>
                  </section>
                ) : null}
                {showInlineTemplates ? (
                  <div
                    className="notes-surface__inline-templates workspace-section"
                    aria-labelledby="notes-templates-label"
                  >
                    <h3 id="notes-templates-label" className="workspace-section-label">
                      Start from a template
                    </h3>
                    <div className="notes-surface__templates" role="group" aria-labelledby="notes-templates-label">
                      {noteTemplates
                        .filter((template) => template.id !== DEFAULT_NOTE_TEMPLATE_ID)
                        .map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            className={`notes-surface__template-btn notes-surface__template-btn--${template.id}`}
                            onClick={() => applyTemplate(template)}
                            disabled={status.kind === "saving" || status.kind === "deleting"}
                          >
                            <span className="notes-surface__template-title">{template.title}</span>
                          </button>
                        ))}
                    </div>
                  </div>
                ) : null}
              </div>
              {status.kind === "error" ? <p className="notes-surface__error">{status.message}</p> : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
