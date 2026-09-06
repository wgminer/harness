import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  ArrowRightLeft,
  Briefcase,
  Check,
  Copy,
  FolderOpen,
  Hash,
  Loader2,
  Mic,
  Minimize2,
  MoreVertical,
  PencilLine,
  Printer,
  RefreshCw,
  Sparkles,
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
  titleFromMarkdownContent,
  type NoteSummary,
  type NoteTemplateConfig,
} from "../shared/writing";
import { buildNotePrintHtml } from "../shared/notePrint";
import { transcriptCleanupSkippedMessage } from "../shared/setupState";
import { countWords, formatWordCount } from "../shared/wordCount";
import { formatMediumTimestamp } from "../shared/formatMediumTimestamp";
import { NotesCodeEditor, type NotesCodeEditorHandle } from "./NotesCodeEditor";
import { getNotesEditorCaretCoordinates } from "./notesEditorExtensions";
import { useDismissible } from "./useDismissible";
import { useScrolledHeader } from "./useScrolledHeader";
import { formatVoiceTimer, useVoiceCapture, type VoiceTranscriptResult } from "./useVoiceCapture";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "saving" }
  | { kind: "deleting" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

type AsideStatus = { kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string };
type PanelMode = "prompt" | "spell";

interface SelectionRange {
  start: number;
  end: number;
  text: string;
}

const MIN_REGENERATE_SPIN_MS = 3000;
const NOTES_SELECTION_MENU_W_PX = 220;
const NOTES_SELECTION_MENU_H_PX = 248;
const NOTES_SELECTION_MENU_GAP_PX = 8;
const NOTES_ASIDE_PANEL_W_PX = 320;
const NOTES_ASIDE_PANEL_MIN_H_PX = 180;
const NOTES_AUTO_SAVE_DEBOUNCE_MS = 800;
const NOTE_WIDTH_MODES = ["narrow", "comfortable"] as const;
type NoteWidthMode = (typeof NOTE_WIDTH_MODES)[number];
const NOTE_WIDTH_LABELS: Record<NoteWidthMode, string> = {
  narrow: "100%",
  comfortable: "640px",
};

const QUICK_REWRITE_PROMPTS = [
  { id: "shorter", label: "Make shorter", prompt: "Make this shorter and more concise.", icon: Minimize2 },
  { id: "formal", label: "Make more formal", prompt: "Make this more formal.", icon: Briefcase },
  { id: "grammar", label: "Fix grammar", prompt: "Fix grammar without changing the meaning.", icon: PencilLine },
] as const;

interface NotesViewProps {
  notes: NoteSummary[];
  onNotesChange: Dispatch<SetStateAction<NoteSummary[]>>;
  initialOpenNoteId?: string | null;
  initialOpenNoteRequestNonce?: number;
  /** True when initialOpenNoteId is a just-created, untouched note — shows the inline template picker. */
  initialOpenNoteIsNew?: boolean;
  onInitialOpenNoteHandled?: () => void;
  onActiveNoteChange?: (noteId: string | null) => void;
  /** Focused Fn transcript waiting to be inserted at the note cursor. */
  pendingHotkeyText?: string | null;
  onPendingHotkeyTextConsumed?: () => void;
  /**
   * When true, mirror focused Fn global recording into toolbar voice chrome
   * without starting a second local capture.
   */
  mirrorGlobalFnRecording?: boolean;
}

/** Insert dictation at the caret, adding a leading space when mid-word/mid-line. */
export function insertNoteDictation(editor: NotesCodeEditorHandle, text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const view = editor.getView();
  let insert = trimmed;
  if (view) {
    const { from, to } = view.state.selection.main;
    if (from === to && from > 0) {
      const prev = view.state.doc.sliceString(from - 1, from);
      if (!/\s/.test(prev)) insert = ` ${trimmed}`;
    }
  }
  editor.insertAtCursor(insert);
  return true;
}

export function NotesView({
  notes,
  onNotesChange: setNotes,
  initialOpenNoteId,
  initialOpenNoteRequestNonce,
  initialOpenNoteIsNew,
  onInitialOpenNoteHandled,
  onActiveNoteChange,
  pendingHotkeyText,
  onPendingHotkeyTextConsumed,
  mirrorGlobalFnRecording = false,
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
    width: NOTES_ASIDE_PANEL_W_PX,
  });
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 24, left: 24 });
  const [asideExpanded, setAsideExpanded] = useState(false);
  const [panelMode, setPanelMode] = useState<PanelMode>("prompt");
  const [copyFeedback, setCopyFeedback] = useState(false);
  const [noteWidthMode, setNoteWidthMode] = useState<NoteWidthMode>("comfortable");
  const [showLineNumbers, setShowLineNumbers] = useState(false);
  const [noteToolbarMenuOpen, setNoteToolbarMenuOpen] = useState(false);
  const savedToastTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);
  const copyFeedbackTimerRef = useRef<number | null>(null);
  const noteToolbarMenuRef = useRef<HTMLDivElement | null>(null);
  const editorWrapRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<NotesCodeEditorHandle | null>(null);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const selectionMenuRef = useRef<HTMLDivElement | null>(null);
  const asidePanelRef = useRef<HTMLElement | null>(null);
  const pendingEditorFocusRef = useRef(false);
  const pendingEditorCaretRef = useRef<number | null>(null);
  const setVoiceErrorRef = useRef<(message: string | null) => void>(() => {});
  const applyNoteTranscriptRef = useRef<
    (text: string, result?: VoiceTranscriptResult) => boolean
  >(() => false);

  const applyNoteTranscript = useCallback(
    (text: string, result?: VoiceTranscriptResult): boolean => {
      const editor = editorRef.current;
      if (!editor || selectedNoteId == null) return false;
      const applied = insertNoteDictation(editor, text);
      if (!applied) return false;
      if (result?.cleanupSkipped === "no_api_key") {
        setVoiceErrorRef.current(transcriptCleanupSkippedMessage());
      }
      return true;
    },
    [selectedNoteId],
  );

  useEffect(() => {
    applyNoteTranscriptRef.current = applyNoteTranscript;
  });

  const {
    voiceState,
    voiceError,
    setVoiceError,
    recordingMs,
    startRecording,
    stopAndTranscribe,
    cancelRecording,
  } = useVoiceCapture({
    onTranscript: (text, result) => applyNoteTranscriptRef.current(text, result),
    mirrorGlobalFnRecording,
  });

  useEffect(() => {
    setVoiceErrorRef.current = setVoiceError;
  });

  useEffect(() => {
    if (!pendingHotkeyText) return;
    const applied = applyNoteTranscript(pendingHotkeyText);
    if (applied) onPendingHotkeyTextConsumed?.();
  }, [applyNoteTranscript, onPendingHotkeyTextConsumed, pendingHotkeyText]);

  const scheduleEditorFocus = useCallback((caret?: number) => {
    pendingEditorFocusRef.current = true;
    pendingEditorCaretRef.current = caret ?? null;
  }, []);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === selectedNoteId) ?? null,
    [selectedNoteId, notes],
  );
  const noteTitle = activeNote
    ? getDisplayNoteTitle(titleFromMarkdownContent(draft, activeNote.title))
    : "Note";
  const noteWordCount = countWords(draft);
  const notesApi = window.harness.notes;
  const hasSelection = selection != null;
  const showSelectionMenu = hasSelection && !asideExpanded;
  const showAsidePanel = hasSelection && asideExpanded;
  const hasProposal = panelOutput.trim().length > 0;

  const closeAsidePanel = useCallback(() => {
    setAsideExpanded(false);
    setSelection(null);
    setPanelPrompt("");
    setPanelOutput("");
    setPanelMode("prompt");
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
    const panelWidth = Math.min(NOTES_ASIDE_PANEL_W_PX, Math.max(180, view.dom.clientWidth - 24));
    const rawLeft = startCoords.left - 12;
    const rawTop = endCoords.bottom + NOTES_SELECTION_MENU_GAP_PX;
    const maxLeft = Math.max(12, view.dom.clientWidth - panelWidth - 12);
    const maxTop = Math.max(12, view.dom.clientHeight - NOTES_ASIDE_PANEL_MIN_H_PX);
    setAsidePosition({
      left: Math.max(12, Math.min(rawLeft, maxLeft)),
      top: Math.max(12, Math.min(rawTop, maxTop)),
      width: panelWidth,
    });
  }, []);

  const updateSelectionMenuPosition = useCallback((range: SelectionRange | null) => {
    const view = editorRef.current?.getView();
    if (!view || !range) return;
    const endCoords = getNotesEditorCaretCoordinates(view, range.end);
    if (!endCoords) return;
    const maxTop = view.dom.clientHeight - NOTES_SELECTION_MENU_H_PX - 12;
    const aboveTop = endCoords.top - NOTES_SELECTION_MENU_H_PX - NOTES_SELECTION_MENU_GAP_PX;
    const belowTop = endCoords.bottom + NOTES_SELECTION_MENU_GAP_PX;
    // Prefer above the caret so the menu does not cover the cursor; fall back below if needed.
    const top = aboveTop >= 12 ? Math.min(aboveTop, maxTop) : Math.max(12, Math.min(belowTop, maxTop));
    const rawLeft = endCoords.left - NOTES_SELECTION_MENU_W_PX + 4;
    const maxLeft = Math.max(12, view.dom.clientWidth - NOTES_SELECTION_MENU_W_PX - 12);
    setMenuPosition({
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
    updateSelectionMenuPosition(range);
  }, [closeAsidePanel, draft, selection, updateAsidePosition, updateSelectionMenuPosition]);

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

  const dirty = draft !== savedDraft;
  const showInlineTemplates = isFreshNote && !dirty;

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

  useDismissible({
    open: noteToolbarMenuOpen,
    onDismiss: () => setNoteToolbarMenuOpen(false),
    refs: [noteToolbarMenuRef],
    pointerEvent: "pointerdown",
    capture: true,
  });

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
      setIsFreshNote(false);
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

  const toggleLineNumbers = useCallback(() => {
    setShowLineNumbers((prev) => !prev);
  }, []);

  const waitForMinSpin = async (loadingStartedAt: number) => {
    const elapsed = performance.now() - loadingStartedAt;
    const remaining = Math.max(0, MIN_REGENERATE_SPIN_MS - elapsed);
    if (remaining > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, remaining));
    }
  };

  const regenerateAside = useCallback(async (options?: { promptOverride?: string; modeOverride?: PanelMode }) => {
    if (!selection) return;
    const mode = options?.modeOverride ?? panelMode;
    const loadingStartedAt = performance.now();
    const activeElement = document.activeElement as HTMLElement | null;

    if (mode === "spell") {
      setAsideStatus({ kind: "loading" });
      try {
        const response = await notesApi.spellCheck({
          selectedText: selection.text,
          beforeText: draft.slice(0, selection.start),
          afterText: draft.slice(selection.end),
          documentText: draft,
        });
        setPanelOutput(response.proposedText);
        await waitForMinSpin(loadingStartedAt);
        activeElement?.focus();
        setAsideStatus({ kind: "idle" });
      } catch (e) {
        await waitForMinSpin(loadingStartedAt);
        activeElement?.focus();
        setAsideStatus({ kind: "error", message: String(e) });
      }
      return;
    }

    const prompt = (options?.promptOverride ?? panelPrompt).trim();
    if (!prompt) {
      setAsideStatus({ kind: "error", message: "Enter a prompt first." });
      return;
    }
    if (options?.promptOverride != null) {
      setPanelPrompt(prompt);
    }
    setAsideStatus({ kind: "loading" });
    try {
      const response = await notesApi.proposeEdit({
        selectedText: selection.text,
        prompt,
        beforeText: draft.slice(0, selection.start),
        afterText: draft.slice(selection.end),
        documentText: draft,
      });
      setPanelOutput(response.proposedText);
      await waitForMinSpin(loadingStartedAt);
      activeElement?.focus();
      setAsideStatus({ kind: "idle" });
    } catch (e) {
      await waitForMinSpin(loadingStartedAt);
      activeElement?.focus();
      setAsideStatus({ kind: "error", message: String(e) });
    }
  }, [selection, panelPrompt, panelMode, notesApi, draft]);

  const approveAside = useCallback(() => {
    if (!selection || !panelOutput.trim()) return;
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

  const openRewritePanel = useCallback(
    (mode: PanelMode, options?: { prompt?: string; autoGenerate?: boolean }) => {
      if (!selection) return;
      const prompt = options?.prompt ?? "";
      setPanelMode(mode);
      setPanelPrompt(prompt);
      setPanelOutput("");
      setAsideStatus({ kind: "idle" });
      setAsideExpanded(true);
      requestAnimationFrame(() => {
        updateAsidePosition(selection);
        if (mode === "prompt" && !options?.autoGenerate) {
          promptRef.current?.focus();
        }
      });
      if (options?.autoGenerate) {
        void regenerateAside({
          modeOverride: mode,
          promptOverride: mode === "prompt" ? prompt : undefined,
        });
      }
    },
    [selection, updateAsidePosition, regenerateAside],
  );

  const openAskAi = useCallback(() => {
    openRewritePanel("prompt");
  }, [openRewritePanel]);

  const openSpellCheck = useCallback(() => {
    openRewritePanel("spell", { autoGenerate: true });
  }, [openRewritePanel]);

  const openQuickRewrite = useCallback(
    (prompt: string) => {
      openRewritePanel("prompt", { prompt, autoGenerate: true });
    },
    [openRewritePanel],
  );

  const handleEditorScroll = useCallback(() => {
    if (!selection) return;
    updateAsidePosition(selection);
    updateSelectionMenuPosition(selection);
  }, [selection, updateAsidePosition, updateSelectionMenuPosition]);

  const previewRows = useMemo(() => {
    const source = panelOutput.replace(/\r/g, "");
    if (!source) return 3;
    const lines = source.split("\n");
    const estimated = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 48)), 0);
    return Math.max(3, Math.min(12, estimated));
  }, [panelOutput]);

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
      updateSelectionMenuPosition(selection);
    });
  }, [selection, asideExpanded, updateAsidePosition, updateSelectionMenuPosition]);

  useEffect(() => {
    if (!showSelectionMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (selectionMenuRef.current?.contains(t)) return;
      if (editorRef.current?.getView()?.dom.contains(t)) return;
      dismissAside();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [showSelectionMenu, dismissAside]);

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
                <div className="notes-surface__toolbar-actions">
                  {voiceError ? <div className="notes-surface__voice-error">{voiceError}</div> : null}
                  {voiceState === "recording" ? (
                    <span className="voice-timer notes-surface__voice-timer">
                      {formatVoiceTimer(recordingMs)}
                    </span>
                  ) : null}
                  {voiceState === "processing" ? (
                    <span className="voice-status notes-surface__voice-status">
                      <Loader2 size={13} className="voice-spinner" />
                      Transcribing…
                    </span>
                  ) : null}
                  {voiceState !== "processing" ? (
                    <button
                      type="button"
                      className={`btn btn-icon notes-surface__details-btn${voiceState === "recording" ? " btn-primary" : " voice-btn"}`}
                      onClick={() =>
                        void (voiceState === "recording" ? stopAndTranscribe() : startRecording())
                      }
                      disabled={
                        selectedNoteId == null ||
                        status.kind === "loading" ||
                        status.kind === "deleting"
                      }
                      title={voiceState === "recording" ? "Stop dictation" : "Dictate into note"}
                      aria-label={voiceState === "recording" ? "Stop dictation" : "Dictate into note"}
                      data-testid="notes-dictate"
                    >
                      {voiceState === "recording" ? (
                        <Check size={15} aria-hidden />
                      ) : (
                        <Mic size={15} aria-hidden />
                      )}
                    </button>
                  ) : null}
                  {voiceState !== "idle" ? (
                    <button
                      type="button"
                      className="btn btn-icon btn-danger notes-surface__details-btn"
                      onClick={() => void cancelRecording()}
                      title="Cancel dictation"
                      aria-label="Cancel dictation"
                    >
                      <X size={15} aria-hidden />
                    </button>
                  ) : null}
                  <div className="notes-surface__toolbar-menu-wrap" ref={noteToolbarMenuRef}>
                    <button
                      type="button"
                      className="btn btn-icon notes-surface__details-btn"
                      aria-expanded={noteToolbarMenuOpen}
                      aria-haspopup="menu"
                      aria-label="Note details"
                      title="Details"
                      onClick={() => setNoteToolbarMenuOpen((v) => !v)}
                    >
                      <MoreVertical size={16} aria-hidden />
                    </button>
                    {noteToolbarMenuOpen ? (
                      <div className="notes-surface__toolbar-menu" role="menu" aria-label="Note details">
                        <div className="notes-surface__toolbar-menu-meta">
                          <div className="notes-surface__toolbar-menu-meta-row">
                            <span className="notes-surface__toolbar-menu-meta-label">Title</span>
                            <span className="notes-surface__toolbar-menu-meta-value" title={noteTitle}>
                              {noteTitle}
                            </span>
                          </div>
                          <div className="notes-surface__toolbar-menu-meta-row">
                            <span className="notes-surface__toolbar-menu-meta-label">Words</span>
                            <span className="notes-surface__toolbar-menu-meta-value">
                              {formatWordCount(noteWordCount)}
                            </span>
                          </div>
                          {activeNote ? (
                            <>
                              <div className="notes-surface__toolbar-menu-meta-row">
                                <span className="notes-surface__toolbar-menu-meta-label">Updated</span>
                                <span className="notes-surface__toolbar-menu-meta-value">
                                  {formatMediumTimestamp(activeNote.updatedAt)}
                                </span>
                              </div>
                              <div className="notes-surface__toolbar-menu-meta-row">
                                <span className="notes-surface__toolbar-menu-meta-label">Created</span>
                                <span className="notes-surface__toolbar-menu-meta-value">
                                  {formatMediumTimestamp(activeNote.createdAt)}
                                </span>
                              </div>
                            </>
                          ) : null}
                        </div>
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
                          onClick={() => {
                            toggleLineNumbers();
                            setNoteToolbarMenuOpen(false);
                          }}
                        >
                          <Hash size={16} aria-hidden />
                          <span>Line numbers ({showLineNumbers ? "on" : "off"})</span>
                        </button>
                        <button
                          type="button"
                          className="notes-surface__toolbar-menu-item"
                          role="menuitem"
                          disabled={!selectedNoteId || status.kind === "saving" || status.kind === "deleting"}
                          onClick={() => {
                            const html = buildNotePrintHtml(noteTitle, draft);
                            void window.harness.notes.print(html, noteTitle);
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
                  showLineNumbers={showLineNumbers}
                  onChange={setDraft}
                  onSelectionChange={updateSelectionState}
                  onScroll={handleEditorScroll}
                />
                {showInlineTemplates ? (
                  <div
                    className="notes-surface__inline-templates"
                    aria-labelledby="notes-templates-label"
                  >
                    <h3 id="notes-templates-label" className="notes-surface__templates-label">
                      Start from a template
                    </h3>
                    <div
                      className="notes-surface__templates"
                      role="group"
                      aria-labelledby="notes-templates-label"
                    >
                      {noteTemplates
                        .filter((template) => template.id !== DEFAULT_NOTE_TEMPLATE_ID)
                        .map((template) => {
                          const preview = template.content.replace(/\s+$/, "");
                          return (
                            <button
                              key={template.id}
                              type="button"
                              className="notes-surface__template-card"
                              onClick={() => applyTemplate(template)}
                              disabled={status.kind === "saving" || status.kind === "deleting"}
                              aria-label={`Start from ${template.title} template`}
                            >
                              <span className="notes-surface__template-title">{template.title}</span>
                              <span className="notes-surface__template-preview" aria-hidden>
                                {preview.length > 0 ? preview : "Empty"}
                              </span>
                            </button>
                          );
                        })}
                    </div>
                  </div>
                ) : null}
                {showSelectionMenu ? (
                  <div
                    ref={selectionMenuRef}
                    className="notes-selection-menu notes-surface__toolbar-menu"
                    role="menu"
                    aria-label="Selection actions"
                    style={{
                      top: `${menuPosition.top}px`,
                      left: `${menuPosition.left}px`,
                    }}
                  >
                    <button
                      type="button"
                      className="notes-surface__toolbar-menu-item"
                      role="menuitem"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void handleCopySelection()}
                    >
                      {copyFeedback ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
                      <span>{copyFeedback ? "Copied" : "Copy"}</span>
                    </button>
                    <button
                      type="button"
                      className="notes-surface__toolbar-menu-item"
                      role="menuitem"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={openSpellCheck}
                    >
                      <SpellCheck size={16} aria-hidden />
                      <span>Fix spelling</span>
                    </button>
                    <button
                      type="button"
                      className="notes-surface__toolbar-menu-item"
                      role="menuitem"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={openAskAi}
                    >
                      <Sparkles size={16} aria-hidden />
                      <span>Ask AI…</span>
                    </button>
                    {QUICK_REWRITE_PROMPTS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="notes-surface__toolbar-menu-item"
                          role="menuitem"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => openQuickRewrite(item.prompt)}
                        >
                          <Icon size={16} aria-hidden />
                          <span>{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                {showAsidePanel ? (
                  <section
                    ref={asidePanelRef}
                    className="notes-aside-panel notes-aside-panel--floating"
                    aria-label={panelMode === "spell" ? "Spelling and grammar" : "Rewrite"}
                    style={{
                      top: `${asidePosition.top}px`,
                      left: `${asidePosition.left}px`,
                      width: `${asidePosition.width}px`,
                    }}
                  >
                    <div className="notes-aside-panel__header">
                      <h3 className="notes-aside-panel__title">
                        {panelMode === "spell" ? "Spelling & grammar" : "Rewrite"}
                      </h3>
                      <button
                        type="button"
                        className="btn btn-icon-sm notes-aside-panel__close"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={dismissAside}
                        aria-label="Close"
                        title="Close"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    <div className="notes-aside-panel__body">
                      {panelMode === "prompt" ? (
                        <div className="notes-aside-panel__field">
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
                            disabled={asideStatus.kind === "loading"}
                          />
                        </div>
                      ) : null}
                      {hasProposal ? (
                        <div className="notes-aside-panel__field">
                          <label className="notes-aside-panel__label" htmlFor="notes-aside-output">
                            Proposal
                          </label>
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
                            rows={previewRows}
                          />
                        </div>
                      ) : null}
                      {asideStatus.kind === "error" ? (
                        <p className="notes-aside-panel__error">{asideStatus.message}</p>
                      ) : null}
                    </div>
                    <div className="notes-aside-panel__footer">
                      {hasProposal ? (
                        <>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={dismissAside}
                          >
                            Discard
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => void regenerateAside()}
                            disabled={asideStatus.kind === "loading"}
                          >
                            <RefreshCw
                              size={12}
                              className={
                                asideStatus.kind === "loading"
                                  ? "notes-aside-panel__regen-icon--spinning"
                                  : undefined
                              }
                            />
                            Regenerate
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={approveAside}
                            disabled={asideStatus.kind === "loading"}
                          >
                            Apply
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-sm btn-primary notes-aside-panel__footer-primary"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => void regenerateAside()}
                          disabled={
                            asideStatus.kind === "loading" ||
                            (panelMode === "prompt" && !panelPrompt.trim())
                          }
                        >
                          <RefreshCw
                            size={12}
                            className={
                              asideStatus.kind === "loading"
                                ? "notes-aside-panel__regen-icon--spinning"
                                : undefined
                            }
                          />
                          {asideStatus.kind === "loading"
                            ? panelMode === "spell"
                              ? "Checking…"
                              : "Generating…"
                            : panelMode === "spell"
                              ? "Check Spelling"
                              : "Generate"}
                        </button>
                      )}
                    </div>
                  </section>
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
