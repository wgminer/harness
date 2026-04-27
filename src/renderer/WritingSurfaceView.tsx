import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRightLeft, FolderOpen, RefreshCw, Save, SquarePen, Trash2, X } from "lucide-react";
import {
  DEFAULT_NOTE_TEMPLATES,
  normalizeNoteTemplates,
  type NoteSummary,
  type NoteTemplateConfig,
} from "../shared/writing";
import { useScrolledHeader } from "./useScrolledHeader";
import { WorkspaceHeader } from "./WorkspaceHeader";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "creating" }
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

interface CaretCoordinates {
  top: number;
  left: number;
  lineHeight: number;
}

const MIN_REGENERATE_SPIN_MS = 3000;
const ASIDE_PANEL_MEASURE_BUFFER_PX = 120;
const NOTE_WIDTH_MODES = ["narrow", "comfortable"] as const;
type NoteWidthMode = (typeof NOTE_WIDTH_MODES)[number];
const NOTE_WIDTH_LABELS: Record<NoteWidthMode, string> = {
  narrow: "100%",
  comfortable: "560px",
};

function getTextareaCaretCoordinates(textarea: HTMLTextAreaElement, position: number): CaretCoordinates {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const props = [
    "boxSizing",
    "width",
    "height",
    "overflowX",
    "overflowY",
    "borderTopWidth",
    "borderRightWidth",
    "borderBottomWidth",
    "borderLeftWidth",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "fontStretch",
    "fontSize",
    "lineHeight",
    "fontFamily",
    "textAlign",
    "textTransform",
    "textIndent",
    "textDecoration",
    "letterSpacing",
    "wordSpacing",
    "tabSize",
  ] as const;

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  for (const prop of props) {
    mirror.style[prop] = computed[prop];
  }

  const safePos = Math.max(0, Math.min(position, textarea.value.length));
  mirror.textContent = textarea.value.slice(0, safePos);
  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(safePos) || " ";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.4 || 20;
  const top = marker.offsetTop + Number.parseFloat(computed.borderTopWidth || "0");
  const left = marker.offsetLeft + Number.parseFloat(computed.borderLeftWidth || "0");
  document.body.removeChild(mirror);
  return { top, left, lineHeight };
}

function renderDraftWithSelection(draft: string, selection: SelectionRange): [string, string, string] {
  return [
    draft.slice(0, selection.start),
    draft.slice(selection.start, selection.end),
    draft.slice(selection.end),
  ];
}

function measureLongestSelectedLineWidth(textarea: HTMLTextAreaElement, selectedText: string): number {
  const normalized = selectedText.replace(/\r/g, "");
  if (!normalized) return 0;
  const lines = normalized.split("\n");
  if (lines.length === 0) return 0;
  const style = window.getComputedStyle(textarea);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    style.fontStretch,
    style.fontSize,
    style.fontFamily,
  ]
    .filter(Boolean)
    .join(" ");

  let maxWidth = 0;
  for (const line of lines) {
    const measured = ctx.measureText(line || " ").width;
    if (measured > maxWidth) {
      maxWidth = measured;
    }
  }
  return maxWidth;
}

function formatUpdatedAt(ms: number): string {
  if (!ms) return "Never";
  const d = new Date(ms);
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatWordCount(count: number): string {
  const normalized = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  return `${normalized.toLocaleString()} ${normalized === 1 ? "word" : "words"}`;
}

interface NotesViewProps {
  initialOpenNoteId?: string | null;
  onInitialOpenNoteHandled?: () => void;
  resetToOverviewNonce?: number;
  onScreenChange?: (screen: "list" | "detail") => void;
}

export function NotesView({
  initialOpenNoteId,
  onInitialOpenNoteHandled,
  resetToOverviewNonce,
  onScreenChange,
}: NotesViewProps) {
  const { scrollRef, scrolled: headerScrolled, onScroll } = useScrolledHeader();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [noteTemplates, setNoteTemplates] = useState<NoteTemplateConfig[]>(
    DEFAULT_NOTE_TEMPLATES.map((template) => ({ ...template })),
  );
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [screen, setScreen] = useState<"list" | "detail">("list");
  const [draft, setDraft] = useState<string>("");
  const [savedDraft, setSavedDraft] = useState<string>("");
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [panelPrompt, setPanelPrompt] = useState<string>("");
  const [panelOutput, setPanelOutput] = useState<string>("");
  const [asideStatus, setAsideStatus] = useState<AsideStatus>({ kind: "idle" });
  const [editorFocused, setEditorFocused] = useState<boolean>(false);
  const [editorScrollTop, setEditorScrollTop] = useState<number>(0);
  const [editorScrollLeft, setEditorScrollLeft] = useState<number>(0);
  const [asidePosition, setAsidePosition] = useState<{ top: number; left: number; width: number }>({
    top: 24,
    left: 24,
    width: 240,
  });
  const [noteWidthMode, setNoteWidthMode] = useState<NoteWidthMode>("comfortable");
  const savedToastTimerRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [selectedNoteId, notes],
  );
  const notesApi = window.electron.notes;
  const asideOpen = selection != null;
  const showSelectionOverlay = asideOpen && !editorFocused && selection != null;

  const closeAsidePanel = useCallback(() => {
    setSelection(null);
    setPanelPrompt("");
    setPanelOutput("");
    setAsideStatus({ kind: "idle" });
  }, []);

  const updateAsidePosition = useCallback((range: SelectionRange | null) => {
    const editor = editorRef.current;
    if (!editor || !range) return;
    const startCoords = getTextareaCaretCoordinates(editor, range.start);
    const endCoords = getTextareaCaretCoordinates(editor, range.end);
    const sameLine = Math.abs(endCoords.top - startCoords.top) < startCoords.lineHeight * 0.6;
    const longestLineWidth = measureLongestSelectedLineWidth(editor, range.text);
    const highlightedWidth = sameLine
      ? Math.max(260, endCoords.left - startCoords.left + ASIDE_PANEL_MEASURE_BUFFER_PX)
      : Math.max(300, longestLineWidth + ASIDE_PANEL_MEASURE_BUFFER_PX);
    const panelWidth = Math.min(620, Math.max(180, highlightedWidth));
    const rawLeft = startCoords.left - editor.scrollLeft - 12;
    const rawTop = endCoords.top - editor.scrollTop + endCoords.lineHeight + 10;
    const maxLeft = Math.max(12, editor.clientWidth - panelWidth - 12);
    const maxTop = Math.max(12, editor.clientHeight - 180);
    setAsidePosition({
      left: Math.max(12, Math.min(rawLeft, maxLeft)),
      top: Math.max(12, Math.min(rawTop, maxTop)),
      width: panelWidth,
    });
  }, []);

  const updateSelectionState = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      closeAsidePanel();
      return;
    }
    const start = editor.selectionStart ?? 0;
    const end = editor.selectionEnd ?? 0;
    if (start === end) {
      closeAsidePanel();
      return;
    }
    const selectionStart = Math.min(start, end);
    const selectionEnd = Math.max(start, end);
    const selectedText = draft.slice(selectionStart, selectionEnd);
    if (!selectedText.trim()) {
      closeAsidePanel();
      return;
    }
    setSelection((prev) => {
      if (prev && prev.start === selectionStart && prev.end === selectionEnd && prev.text === selectedText) {
        return prev;
      }
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
    updateAsidePosition({ start: selectionStart, end: selectionEnd, text: selectedText });
  }, [closeAsidePanel, draft, selection, updateAsidePosition]);

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
      closeAsidePanel();
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [closeAsidePanel, notesApi]);

  useEffect(() => {
    void loadNotes();
    void window.electron.settings
      .get()
      .then((settings) => {
        setNoteTemplates(normalizeNoteTemplates((settings as { notes?: { templates?: unknown } }).notes?.templates));
      })
      .catch(() => {
        setNoteTemplates(DEFAULT_NOTE_TEMPLATES.map((template) => ({ ...template })));
      });
    return () => {
      if (savedToastTimerRef.current != null) {
        window.clearTimeout(savedToastTimerRef.current);
      }
    };
  }, [loadNotes]);

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
      setScreen("detail");
      setStatus({ kind: "loading" });
      await loadActiveNote(initialOpenNoteId);
      if (!cancelled) {
        requestAnimationFrame(() => editorRef.current?.focus());
      }
      onInitialOpenNoteHandled?.();
    };
    void openInitialNote();
    return () => {
      cancelled = true;
    };
  }, [initialOpenNoteId, loadActiveNote, onInitialOpenNoteHandled]);

  useEffect(() => {
    onScreenChange?.(screen);
  }, [onScreenChange, screen]);

  useEffect(() => {
    if (resetToOverviewNonce == null) return;
    closeAsidePanel();
    setScreen("list");
  }, [closeAsidePanel, resetToOverviewNonce]);

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
  }, [selectedNoteId, dirty, draft, notesApi]);

  const createNote = useCallback(async (template?: NoteTemplateConfig) => {
    setStatus({ kind: "creating" });
    try {
      const note = await notesApi.create(template?.title, template?.content);
      const summary = {
        id: note.id,
        title: note.title,
        updatedAt: note.updatedAt,
        createdAt: note.createdAt,
        wordCount: note.wordCount,
      };
      setNotes((prev) => [summary, ...prev].sort((a, b) => b.updatedAt - a.updatedAt));
      setSelectedNoteId(note.id);
      setDraft(note.content);
      setSavedDraft(note.content);
      setScreen("detail");
      closeAsidePanel();
      setStatus({ kind: "idle" });
      editorRef.current?.focus();
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [closeAsidePanel, notesApi]);

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
      closeAsidePanel();
      setStatus({ kind: "idle" });
    } catch (e) {
      setStatus({ kind: "error", message: String(e) });
    }
  }, [selectedNoteId, closeAsidePanel, notesApi]);

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
    closeAsidePanel();
    setScreen("list");
  }, [closeAsidePanel]);

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
  }, [selection, panelPrompt, notesApi]);

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
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(insertionStart, insertionStart);
    });
  }, [selection, draft, panelOutput, closeAsidePanel]);

  const dismissAside = useCallback(() => {
    closeAsidePanel();
    requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const caret = editor.selectionEnd ?? 0;
      editor.focus();
      editor.setSelectionRange(caret, caret);
    });
  }, [closeAsidePanel]);

  const handleEditorScroll = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    setEditorScrollTop(editor.scrollTop);
    setEditorScrollLeft(editor.scrollLeft);
    updateAsidePosition(selection);
  }, [selection, updateAsidePosition]);

  const handleEditorFocus = useCallback(() => {
    setEditorFocused(true);
  }, []);

  const handleEditorBlur = useCallback(() => {
    setEditorFocused(false);
  }, []);

  const [beforeSelection, selectedSegment, afterSelection] = selection
    ? renderDraftWithSelection(draft, selection)
    : [draft, "", ""];

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
    if (!asideOpen) return;
    requestAnimationFrame(() => {
      promptRef.current?.focus();
      updateAsidePosition(selection);
    });
  }, [asideOpen, selection, updateAsidePosition]);

  return (
    <div className="workspace-page notes-surface">
      {screen === "list" ? (
        <WorkspaceHeader
          title="Notes"
          icon={<SquarePen size={18} />}
          scrolled={headerScrolled}
          titleRowClassName="notes-surface__header-title-row"
        />
      ) : null}
      <div
        ref={scrollRef}
        className={`workspace-scroll notes-surface__scroll${screen === "detail" ? " notes-surface__scroll--detail" : ""}`}
        onScroll={onScroll}
      >
        {screen === "list" ? (
          <section className="notes-surface__panel">
            <div className="notes-surface__templates" aria-label="Create note templates">
              {noteTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className="notes-surface__template-btn"
                  onClick={() => void createNote(template)}
                  disabled={status.kind === "creating" || status.kind === "saving" || status.kind === "deleting"}
                >
                  <span className="notes-surface__template-title">{template.title}</span>
                  <span className="notes-surface__template-description">{template.description}</span>
                </button>
              ))}
            </div>
            <ul className="notes-surface__notes" aria-label="Notes list">
              {notes.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    className="notes-surface__note-item"
                    onClick={() => void openNote(note.id)}
                  >
                    <span className="notes-surface__note-title" title={note.title}>
                      {note.title}
                    </span>
                    <span className="notes-surface__note-time">
                      <span className="notes-surface__note-time-default">{formatUpdatedAt(note.updatedAt)}</span>
                      <span className="notes-surface__note-time-hover">{formatWordCount(note.wordCount)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {notes.length === 0 ? <p className="notes-surface__empty">No notes yet. Create one to get started.</p> : null}
          </section>
        ) : (
          <section className="notes-surface__detail">
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
                <strong className="notes-surface__meta-title" title={activeNote?.title ?? "Note"}>
                  {activeNote?.title ?? "Note"}
                </strong>
              </div>
              <button
                type="button"
                className="btn btn-icon"
                onClick={cycleNoteWidthMode}
                aria-label={`Cycle note width (currently ${NOTE_WIDTH_LABELS[noteWidthMode]})`}
                title={`Text width: ${NOTE_WIDTH_LABELS[noteWidthMode]}`}
              >
                <ArrowRightLeft size={16} />
              </button>
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
                className="btn btn-icon"
                onClick={() => void window.electron.notes.showInFolder(selectedNoteId)}
                disabled={!selectedNoteId || status.kind === "saving" || status.kind === "deleting"}
                aria-label="Show note file"
                title="Show file"
              >
                <FolderOpen size={16} />
              </button>
              <button
                type="button"
                className="btn btn-primary notes-surface__save-btn"
                onClick={() => void save()}
                disabled={!dirty || status.kind === "saving" || !selectedNoteId}
              >
                <Save size={14} />
                {status.kind === "saving"
                  ? "Saving..."
                  : !dirty || !selectedNoteId
                    ? "Saved"
                    : "Save"}
              </button>
            </div>
            <div className={`notes-surface__editor-wrap notes-surface__editor-wrap--${noteWidthMode}`}>
              <textarea
                ref={editorRef}
                className="notes-surface__editor"
                data-testid="notes-editor"
                aria-label="Notes editor"
                placeholder={status.kind === "loading" ? "Loading..." : "Write your note here..."}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onSelect={updateSelectionState}
                onMouseUp={updateSelectionState}
                onKeyUp={updateSelectionState}
                onScroll={handleEditorScroll}
                onFocus={handleEditorFocus}
                onBlur={handleEditorBlur}
                spellCheck
              />
              {showSelectionOverlay ? (
                <div className="notes-surface__editor-overlay" aria-hidden>
                  <div
                    className="notes-surface__editor-overlay-content"
                    style={{ transform: `translate(${-editorScrollLeft}px, ${-editorScrollTop}px)` }}
                  >
                    {beforeSelection}
                    <mark className="notes-surface__editor-overlay-highlight">{selectedSegment}</mark>
                    {afterSelection}
                  </div>
                </div>
              ) : null}
              {asideOpen ? (
                <section
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
                        className="notes-aside-panel__cancel-btn"
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
                        className="btn btn-primary btn-sm notes-aside-panel__corner-btn notes-aside-panel__corner-btn--approve"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={approveAside}
                      >
                        <ArrowRightLeft size={12} />
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
                            const isComposing = e.isComposing || nativeEvent.isComposing;
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
                          Regenerate
                        </button>
                      </div>
                    </div>
                    {asideStatus.kind === "error" ? (
                      <p className="notes-aside-panel__error">{asideStatus.message}</p>
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
            {status.kind === "error" ? <p className="notes-surface__error">{status.message}</p> : null}
          </section>
        )}
      </div>
    </div>
  );
}
