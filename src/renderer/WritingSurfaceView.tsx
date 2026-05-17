import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowRightLeft,
  Check,
  PaintBucket,
  Copy,
  FolderOpen,
  MoreVertical,
  Printer,
  RefreshCw,
  Save,
  NotebookText,
  Trash2,
  X,
} from "lucide-react";
import {
  DEFAULT_NOTE_TEMPLATES,
  getListContinuationPrefixForLine,
  interpolateNoteTemplateContent,
  normalizeNoteTemplates,
  type NoteSummary,
  type NoteTemplateConfig,
} from "../shared/writing";
import { buildNotePrintHtml } from "../shared/notePrint";
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
const NOTES_SELECTION_TOOLBAR_W_PX = 66;
const NOTES_SELECTION_TOOLBAR_H_PX = 36;
const NOTES_SELECTION_TOOLBAR_GAP_PX = 8;
const NOTES_AUTO_SAVE_DEBOUNCE_MS = 800;
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

const noteRelativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function formatTimeAgo(ms: number): string {
  if (!ms || !Number.isFinite(ms)) return "Never";
  const deltaMs = ms - Date.now();
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  const weekMs = 7 * dayMs;
  const monthMs = 30 * dayMs;
  const yearMs = 365 * dayMs;

  if (Math.abs(deltaMs) < hourMs) {
    const minutes = Math.round(deltaMs / minuteMs);
    return noteRelativeTimeFormatter.format(minutes, "minute");
  }
  if (Math.abs(deltaMs) < dayMs) {
    const hours = Math.round(deltaMs / hourMs);
    return noteRelativeTimeFormatter.format(hours, "hour");
  }
  if (Math.abs(deltaMs) < weekMs) {
    const days = Math.round(deltaMs / dayMs);
    return noteRelativeTimeFormatter.format(days, "day");
  }
  if (Math.abs(deltaMs) < yearMs) {
    const months = Math.round(deltaMs / monthMs);
    return noteRelativeTimeFormatter.format(months, "month");
  }
  const years = Math.round(deltaMs / yearMs);
  return noteRelativeTimeFormatter.format(years, "year");
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
  const [toolbarPosition, setToolbarPosition] = useState<{ top: number; left: number }>({ top: 24, left: 24 });
  const [asideExpanded, setAsideExpanded] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [noteWidthMode, setNoteWidthMode] = useState<NoteWidthMode>("comfortable");
  const [noteToolbarMenuOpen, setNoteToolbarMenuOpen] = useState(false);
  const savedToastTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const noteToolbarMenuRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement | null>(null);
  const asidePanelRef = useRef<HTMLElement | null>(null);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [selectedNoteId, notes],
  );
  const notesApi = window.electron.notes;
  const hasSelection = selection != null;
  const showSelectionToolbar = hasSelection && !asideExpanded;
  const showAsidePanel = hasSelection && asideExpanded;
  const showSelectionOverlay = hasSelection && !editorFocused;

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

  const updateToolbarPosition = useCallback((range: SelectionRange | null) => {
    const editor = editorRef.current;
    if (!editor || !range) return;
    const endCoords = getTextareaCaretCoordinates(editor, range.end);
    const lineHeight = endCoords.lineHeight;
    const belowTop =
      endCoords.top - editor.scrollTop + lineHeight + NOTES_SELECTION_TOOLBAR_GAP_PX;
    const top = Math.max(
      12,
      Math.min(belowTop, editor.clientHeight - NOTES_SELECTION_TOOLBAR_H_PX - 12),
    );
    const anchorLeft = endCoords.left - editor.scrollLeft;
    const rawLeft = anchorLeft - NOTES_SELECTION_TOOLBAR_W_PX + 4;
    const maxLeft = Math.max(12, editor.clientWidth - NOTES_SELECTION_TOOLBAR_W_PX - 12);
    setToolbarPosition({
      top,
      left: Math.max(12, Math.min(rawLeft, maxLeft)),
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

  useEffect(() => {
    if (screen !== "detail") setNoteToolbarMenuOpen(false);
  }, [screen]);

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
      const note = await notesApi.create(
        template?.title,
        template ? interpolateNoteTemplateContent(template.content) : undefined,
      );
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

  const openAiAside = useCallback(() => {
    if (!selection) return;
    setAsideExpanded(true);
    requestAnimationFrame(() => {
      updateAsidePosition(selection);
      promptRef.current?.focus();
    });
  }, [selection, updateAsidePosition]);

  const handleEditorScroll = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    setEditorScrollTop(editor.scrollTop);
    setEditorScrollLeft(editor.scrollLeft);
    if (!selection) return;
    updateAsidePosition(selection);
    updateToolbarPosition(selection);
  }, [selection, updateAsidePosition, updateToolbarPosition]);

  const handleEditorKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const nativeEvent = e.nativeEvent as KeyboardEvent;
      if (e.isComposing || nativeEvent.isComposing || e.repeat) return;
      const editor = e.currentTarget;
      const value = editor.value;
      const selectionStart = editor.selectionStart ?? 0;
      const selectionEnd = editor.selectionEnd ?? 0;
      if (selectionStart !== selectionEnd) return;
      const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
      const lineEnd = value.indexOf("\n", selectionStart);
      const safeLineEnd = lineEnd === -1 ? value.length : lineEnd;
      if (selectionStart !== safeLineEnd) return;
      const line = value.slice(lineStart, safeLineEnd);
      const continuation = getListContinuationPrefixForLine(line);
      if (!continuation) return;
      e.preventDefault();
      const nextDraft = `${value.slice(0, selectionStart)}\n${continuation}${value.slice(selectionEnd)}`;
      const nextCaret = selectionStart + 1 + continuation.length;
      setDraft(nextDraft);
      requestAnimationFrame(() => editor.setSelectionRange(nextCaret, nextCaret));
      return;
    }

    if (e.key !== "Tab" || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    const editor = e.currentTarget;
    const value = editor.value;
    const selectionStart = editor.selectionStart ?? 0;
    const selectionEnd = editor.selectionEnd ?? 0;

    if (selectionStart === selectionEnd) {
      if (e.shiftKey) {
        const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
        if (value[lineStart] !== "\t") {
          return;
        }
        const nextDraft = `${value.slice(0, lineStart)}${value.slice(lineStart + 1)}`;
        const nextCaret = selectionStart > lineStart ? selectionStart - 1 : selectionStart;
        setDraft(nextDraft);
        requestAnimationFrame(() => editor.setSelectionRange(nextCaret, nextCaret));
        return;
      }
      const nextDraft = `${value.slice(0, selectionStart)}\t${value.slice(selectionEnd)}`;
      setDraft(nextDraft);
      requestAnimationFrame(() => editor.setSelectionRange(selectionStart + 1, selectionStart + 1));
      return;
    }

    const selectedBlockStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const selectedBlock = value.slice(selectedBlockStart, selectionEnd);

    if (e.shiftKey) {
      const unindentedBlock = selectedBlock.replace(/^\t/gm, "");
      const nextDraft = value.slice(0, selectedBlockStart) + unindentedBlock + value.slice(selectionEnd);
      const removedAtStart = value[selectedBlockStart] === "\t" ? 1 : 0;
      const removedTotal = selectedBlock.length - unindentedBlock.length;
      setDraft(nextDraft);
      requestAnimationFrame(() => {
        editor.setSelectionRange(
          Math.max(selectedBlockStart, selectionStart - removedAtStart),
          Math.max(selectedBlockStart, selectionEnd - removedTotal),
        );
      });
      return;
    }

    const indentedBlock = selectedBlock.replace(/^/gm, "\t");
    const nextDraft = value.slice(0, selectedBlockStart) + indentedBlock + value.slice(selectionEnd);
    const addedTotal = indentedBlock.length - selectedBlock.length;
    setDraft(nextDraft);
    requestAnimationFrame(() => {
      editor.setSelectionRange(selectionStart + 1, selectionEnd + addedTotal);
    });
  }, []);

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
    if (autoSaveTimerRef.current != null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (!dirty || !selectedNoteId || screen !== "detail" || status.kind === "loading" || status.kind === "deleting") {
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
  }, [dirty, save, screen, selectedNoteId, status.kind]);

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
      if (editorRef.current?.contains(t)) return;
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

  return (
    <div className="workspace-page notes-surface">
      {screen === "list" ? (
        <WorkspaceHeader
          title="Notes"
          icon={<NotebookText size={18} />}
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
                      <span className="notes-surface__note-time-default">{formatTimeAgo(note.updatedAt)}</span>
                      <span className="notes-surface__note-time-hover">
                        {formatTimeAgo(note.updatedAt)} · {formatWordCount(note.wordCount)}
                      </span>
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
                        const title = activeNote?.title ?? "Note";
                        const html = buildNotePrintHtml(title, draft);
                        void window.electron.notes.print(html, title);
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
                        void window.electron.notes.showInFolder(id);
                        setNoteToolbarMenuOpen(false);
                      }}
                    >
                      <FolderOpen size={16} aria-hidden />
                      <span>Show file</span>
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
                onKeyDown={handleEditorKeyDown}
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
            </div>
            {status.kind === "error" ? <p className="notes-surface__error">{status.message}</p> : null}
          </section>
        )}
      </div>
    </div>
  );
}
