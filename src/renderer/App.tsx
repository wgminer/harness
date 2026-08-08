import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChatView } from "./ChatView";
import { SettingsView } from "./SettingsView";
import { setCachedAccessibilityTrusted, setCachedHasOpenAIApiKey, setCachedSettings } from "./settings/settingsSessionCache";
import { TasksView } from "./TasksView";
import { SearchView } from "./SearchView";
import { NotesView } from "./WritingSurfaceView";
import { ImageCanvasView } from "./ImageCanvasView";
import { Sidebar } from "./Sidebar";
import { SetupNoticeModal } from "./SetupNoticeModal";
import { HotkeyRecordingOverlay } from "./HotkeyRecordingOverlay";
import { wireGlobalHotkeyActions, type GlobalHotkeyOverlayPhase } from "./globalHotkeyController";
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, type LayoutOptions, type Settings } from "../shared/types";
import { DEFAULT_UI_SESSION } from "../shared/uiSession";
import type {} from "../shared/desktopAPI";
import { isSidebarVisibleConversation, isTimePlaceholderTitle } from "../shared/conversationSession";
import {
  getDefaultNoteTemplate,
  normalizeDefaultNoteTemplateId,
  normalizeNoteTemplates,
  type NoteSummary,
} from "../shared/writing";
import type { GeneratedImage } from "../shared/images";
import { conversationDisplayTitle, isConversationTitlePending } from "./chatDisplayTitle";
import type { Conversation, View } from "./sidebarUtils";
import {
  collectSetupGaps,
  shouldShowSetupNotice,
  type SetupGap,
} from "../shared/setupState";
import type { SettingsTabId } from "./settings/settingsNavConfig";
import { IDLE_UPDATE_STATUS, type UpdateStatus } from "../shared/updateStatus";
import {
  DEFAULT_LIBRARY_PEEK_TUNING,
  computeLibraryPeekTarget,
  initialLibraryPeekSpring,
  libraryEdgeDistance,
  libraryPeekMaxFraction,
  libraryPeekSpringSettled,
  stepLibraryPeekSpring,
  updateLibraryPeekTowardIntent,
  type LibraryPeekSpring,
} from "./libraryPeek";

function removeTitleAwaitingId(
  prev: Record<string, true>,
  id: string,
): Record<string, true> {
  if (!(id in prev)) return prev;
  const next = { ...prev };
  delete next[id];
  return next;
}
export default function App() {
  const [view, setView] = useState<View>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [layout, setLayout] = useState<LayoutOptions>(DEFAULT_LAYOUT);
  /** Incremented when the chat composer should be focused. */
  const [focusComposerNonce, setFocusComposerNonce] = useState(0);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(IDLE_UPDATE_STATUS);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  /** True while the open chat is waiting on / streaming from the chat model (not composer voice). */
  const [activeChatProcessing, setActiveChatProcessing] = useState(false);
  /** Per-conversation refcount for async LLM thread title generation after a reply. */
  const [titleGenInFlight, setTitleGenInFlight] = useState<Record<string, number>>({});
  /** Optimistic pending until Rust start/end settles — avoids Empty/Dictation flash before `started`. */
  const [titleAwaitingIds, setTitleAwaitingIds] = useState<Record<string, true>>({});
  const harnessE2eRef = useRef(false);  /** Note id to open when entering Notes from chat message action, sidebar selection, or creation. */
  const [pendingOpenNoteRequest, setPendingOpenNoteRequest] = useState<{
    id: string;
    nonce: number;
    isNew?: boolean;
  } | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [activeImageId, setActiveImageId] = useState<string | null>(null);
  const [uiSessionReady, setUiSessionReady] = useState(false);
  const [setupGaps, setSetupGaps] = useState<SetupGap[]>([]);
  const [setupNoticeOpen, setSetupNoticeOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId | undefined>();
  const [openAIConfigured, setOpenAIConfigured] = useState(false);
  const [setupStateLoaded, setSetupStateLoaded] = useState(false);
  const [openNoteInStickyWindow, setOpenNoteInStickyWindow] = useState(
    DEFAULT_UI_SESSION.openNoteInStickyWindow ?? false,
  );
  /** Library drawer: pinned open, or temporarily open via dock hover after peek. */
  const [libraryPinned, setLibraryPinned] = useState(false);
  const [libraryHoverOpen, setLibraryHoverOpen] = useState(false);
  const libraryCloseTimerRef = useRef<number | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  const libraryPeekRafRef = useRef<number | null>(null);
  const libraryPeekPendingXRef = useRef<number | null>(null);
  const libraryPeekLastXRef = useRef<number | null>(null);
  const libraryPeekTowardRef = useRef(false);
  const libraryPeekSpringRef = useRef<LibraryPeekSpring>(initialLibraryPeekSpring());
  const libraryPeekLastTsRef = useRef<number | null>(null);
  const libraryPinnedRef = useRef(libraryPinned);
  const libraryHoverOpenRef = useRef(libraryHoverOpen);
  const librarySideRef = useRef(layout.sidebar);
  libraryPinnedRef.current = libraryPinned;
  libraryHoverOpenRef.current = libraryHoverOpen;
  librarySideRef.current = layout.sidebar;

  const libraryOpen = libraryPinned || libraryHoverOpen;

  const clearLibraryCloseTimer = useCallback(() => {
    if (libraryCloseTimerRef.current != null) {
      window.clearTimeout(libraryCloseTimerRef.current);
      libraryCloseTimerRef.current = null;
    }
  }, []);

  const applyLibraryPeekCss = useCallback((peek: number) => {
    const el = appRef.current;
    if (!el) return;
    el.style.setProperty("--library-peek", String(peek));
    el.dataset.libraryPeeking = peek > 0.02 && peek < 1 ? "true" : "false";
  }, []);

  const scheduleLibraryHoverClose = useCallback(() => {
    clearLibraryCloseTimer();
    libraryCloseTimerRef.current = window.setTimeout(() => {
      setLibraryHoverOpen(false);
      libraryCloseTimerRef.current = null;
    }, DEFAULT_LIBRARY_PEEK_TUNING.hoverCloseDelayMs);
  }, [clearLibraryCloseTimer]);

  const openLibraryHover = useCallback(() => {
    clearLibraryCloseTimer();
    setLibraryHoverOpen(true);
  }, [clearLibraryCloseTimer]);

  const toggleLibraryPinned = useCallback(() => {
    setLibraryPinned((prev) => {
      const next = !prev;
      if (next) setLibraryHoverOpen(false);
      return next;
    });
  }, []);

  const closeLibraryIfUnpinned = useCallback(() => {
    if (!libraryPinned) {
      setLibraryHoverOpen(false);
    }
  }, [libraryPinned]);

  useEffect(() => () => clearLibraryCloseTimer(), [clearLibraryCloseTimer]);

  useEffect(() => {
    const el = appRef.current;
    if (!el) return;
    el.style.setProperty(
      "--library-latch-duration",
      `${DEFAULT_LIBRARY_PEEK_TUNING.latchDurationMs}ms`,
    );
  }, []);

  // Sync peek CSS when pinned / hover-open latches or releases.
  useEffect(() => {
    libraryPeekSpringRef.current = initialLibraryPeekSpring(libraryPinned || libraryHoverOpen ? 1 : 0);
    libraryPeekLastTsRef.current = null;
    if (libraryPinned || libraryHoverOpen) {
      applyLibraryPeekCss(1);
    } else {
      applyLibraryPeekCss(0);
    }
  }, [libraryPinned, libraryHoverOpen, applyLibraryPeekCss]);

  // Proximity target + JS spring (CSS transitions can't overshoot while tracking the cursor).
  // Peek only while the pointer is moving toward the library edge; full open is dock hover.
  useEffect(() => {
    if (libraryPinned || libraryHoverOpen) return;

    const stopPeekLoop = () => {
      if (libraryPeekRafRef.current != null) {
        window.cancelAnimationFrame(libraryPeekRafRef.current);
        libraryPeekRafRef.current = null;
      }
      libraryPeekLastTsRef.current = null;
    };

    const tick = (now: number) => {
      libraryPeekRafRef.current = null;
      if (libraryPinnedRef.current || libraryHoverOpenRef.current) return;

      const el = appRef.current;
      const pendingX = libraryPeekPendingXRef.current;
      if (!el || pendingX == null) return;

      const lastTs = libraryPeekLastTsRef.current;
      libraryPeekLastTsRef.current = now;
      const dtSeconds = Math.min(1 / 30, Math.max(1 / 120, lastTs == null ? 1 / 60 : (now - lastTs) / 1000));
      const tuning = DEFAULT_LIBRARY_PEEK_TUNING;
      const peekMax = libraryPeekMaxFraction(tuning.peekMaxPx);

      const rect = el.getBoundingClientRect();
      const x = pendingX - rect.left;
      const side = librarySideRef.current === "right" ? "right" : "left";
      const lastX = libraryPeekLastXRef.current;
      const deltaX = lastX == null ? 0 : pendingX - lastX;
      libraryPeekLastXRef.current = pendingX;

      const distance = libraryEdgeDistance(x, rect.width, side);
      libraryPeekTowardRef.current = updateLibraryPeekTowardIntent({
        distance,
        deltaX,
        side,
        previousToward: libraryPeekTowardRef.current,
        zonePx: tuning.zonePx,
      });

      const target = computeLibraryPeekTarget({
        x,
        viewportWidth: rect.width,
        side,
        zonePx: tuning.zonePx,
        peekMax,
        movingToward: libraryPeekTowardRef.current,
      });

      libraryPeekSpringRef.current = stepLibraryPeekSpring(
        libraryPeekSpringRef.current,
        target,
        dtSeconds,
        {
          stiffness: tuning.stiffness,
          damping: tuning.damping,
          overshoot: tuning.overshoot,
          peekMax,
        },
      );
      applyLibraryPeekCss(libraryPeekSpringRef.current.value);

      if (!libraryPeekSpringSettled(libraryPeekSpringRef.current, target)) {
        libraryPeekRafRef.current = window.requestAnimationFrame(tick);
      }
    };

    const ensurePeekLoop = () => {
      if (libraryPeekRafRef.current != null) return;
      libraryPeekRafRef.current = window.requestAnimationFrame(tick);
    };

    const onPointerMove = (event: PointerEvent) => {
      libraryPeekPendingXRef.current = event.clientX;
      ensurePeekLoop();
    };

    window.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      stopPeekLoop();
      libraryPeekPendingXRef.current = null;
      libraryPeekLastXRef.current = null;
      libraryPeekTowardRef.current = false;
    };
  }, [libraryPinned, libraryHoverOpen, applyLibraryPeekCss]);

  const [pendingHotkeyText, setPendingHotkeyText] = useState<string | null>(null);
  /** When true, hotkey text is always pre-filled (never auto-sent). Used for global recording while the app was unfocused. */
  const [pendingHotkeyDraftOnly, setPendingHotkeyDraftOnly] = useState(false);
  const [globalHotkeyOverlaySession, setGlobalHotkeyOverlaySession] = useState(false);
  const [globalHotkeyOverlayPhase, setGlobalHotkeyOverlayPhase] =
    useState<GlobalHotkeyOverlayPhase>("idle");
  const [globalHotkeyError, setGlobalHotkeyErrorState] = useState<string | null>(null);
  const [globalHotkeyRecordingPath, setGlobalHotkeyRecordingPath] = useState<string | null>(null);
  const overlaySessionRef = useRef(false);

  const setGlobalHotkeyError = useCallback((message: string | null, recordingPath?: string | null) => {
    setGlobalHotkeyErrorState(message);
    if (recordingPath !== undefined) {
      setGlobalHotkeyRecordingPath(recordingPath);
    }
  }, []);

  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);
  useEffect(() => {
    overlaySessionRef.current = globalHotkeyOverlaySession;
  }, [globalHotkeyOverlaySession]);

  const refreshSetupState = useCallback(async () => {
    const [settings, syncStatus, credentialStatus, platform] = await Promise.all([
      window.harness.settings.get() as Promise<Settings>,
      window.harness.sync.getStatus(),
      window.harness.credentials.getStatus(),
      window.harness.system.getPlatform(),
    ]);
    setCachedSettings(settings);
    setCachedHasOpenAIApiKey(credentialStatus.hasOpenAIApiKey);
    let accessibilityTrusted: boolean | null = null;
    if (platform === "darwin") {
      accessibilityTrusted = await window.harness.system.macosAccessibilityTrusted();
      setCachedAccessibilityTrusted(accessibilityTrusted);
    }
    const gaps = collectSetupGaps({
      hasOpenAIApiKey: credentialStatus.hasOpenAIApiKey,
      syncConfigured: syncStatus.configured,
      platform,
      accessibilityTrusted,
    });
    setSetupGaps(gaps);
    setOpenAIConfigured(credentialStatus.hasOpenAIApiKey);
    setSetupStateLoaded(true);
    return gaps;
  }, []);

  const prevViewRef = useRef<View>(view);
  useEffect(() => {
    const prev = prevViewRef.current;
    if (prev === "settings" && view !== "settings") {
      // Drop deep-link tab so the next System open defaults to General.
      setSettingsInitialTab(undefined);
      void refreshSetupState();
    }
    prevViewRef.current = view;
  }, [view, refreshSetupState]);

  const handleViewChange = useCallback((next: View) => {
    if (next === "settings") {
      setSettingsInitialTab(undefined);
    }
    setView(next);
  }, []);

  const handleConversationSelect = useCallback((id: string) => {
    setConversationId(id);
    setView("chat");
  }, []);

  const openSettingsForGap = useCallback((gap: SetupGap) => {
    setSettingsInitialTab(gap.settingsTab);
    setView("settings");
    setSetupNoticeOpen(false);
  }, []);

  const openDataSettings = useCallback(() => {
    setSettingsInitialTab("data");
    setView("settings");
  }, []);

  const dismissSetupNotice = useCallback(() => {
    setSetupNoticeOpen(false);
    if (!setupGaps.some((gap) => gap.severity === "required")) {
      void window.harness.uiSession.set({ setupNoticeDismissed: true });
    }
  }, [setupGaps]);

  const resolveConversationId = useCallback(
    (list: Conversation[], preferredId: string | null): string | null => {
      if (list.length === 0) return null;
      if (preferredId) {
        const preferred = list.find((c) => c.id === preferredId);
        if (preferred && isSidebarVisibleConversation(preferred)) return preferredId;
      }
      return list.find(isSidebarVisibleConversation)?.id ?? null;
    },
    []
  );

  const loadConversations = useCallback(async () => {
    const [list, session, settings] = await Promise.all([
      window.harness.memory.listConversations(),
      window.harness.uiSession.get(),
      window.harness.settings.get(),
    ]);
    setCachedSettings(settings);
    const openToCompose =
      settings.chat?.openToComposeOnLaunch ?? DEFAULT_SETTINGS.chat!.openToComposeOnLaunch;
    setConversations(list);
    if (openToCompose) {
      setView("chat");
      setConversationId(null);
    } else {
      setView(session.view);
      setConversationId(resolveConversationId(list, session.conversationId));
      if (session.notesOpenNoteId) {
        setPendingOpenNoteRequest({ id: session.notesOpenNoteId, nonce: Date.now() });
      }
      if (session.imagesOpenImageId) {
        setActiveImageId(session.imagesOpenImageId);
      }
    }
    // Preference, not restore target — always load, including when open-to-compose skips view restore.
    setOpenNoteInStickyWindow(session.openNoteInStickyWindow === true);
    setUiSessionReady(true);
  }, [resolveConversationId]);

  /** Reload sidebar list after sync/import without resetting view from session. */
  const refreshConversations = useCallback(async () => {
    const list = await window.harness.memory.listConversations();
    setConversations(list);
    setConversationId((current) => resolveConversationId(list, current));
    setTitleAwaitingIds((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const id of Object.keys(prev)) {
        const row = list.find((c) => c.id === id);
        if (row && !isTimePlaceholderTitle(row.title)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [resolveConversationId]);

  const markTitleAwaiting = useCallback((id: string) => {
    if (harnessE2eRef.current) return;
    setTitleAwaitingIds((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  const loadNotesList = useCallback(async () => {
    const list = await window.harness.notes.list();
    setNotes(list);
  }, []);

  const loadImagesList = useCallback(async () => {
    const list = await window.harness.images.list();
    setImages(list);
  }, []);

  useEffect(() => {
    void loadNotesList();
  }, [loadNotesList]);

  useEffect(() => {
    void loadImagesList();
  }, [loadImagesList]);

  /** Opens a note in the main pane's Notes view (from chat, sidebar, or another window). */
  const openNoteInMain = useCallback((noteId: string, opts?: { isNew?: boolean }) => {
    setPendingOpenNoteRequest({ id: noteId, nonce: Date.now(), isNew: opts?.isNew ?? false });
    setView("notes");
    // Chat (and other surfaces) may create notes outside App state — refresh so the row appears.
    void loadNotesList();
  }, [loadNotesList]);

  const openImageInMain = useCallback((imageId: string) => {
    setActiveImageId(imageId);
    setView("images");
    void loadImagesList();
  }, [loadImagesList]);

  const handleSelectNoteFromLibrary = useCallback((id: string) => {
    openNoteInMain(id);
  }, [openNoteInMain]);

  const handleSelectImageFromLibrary = useCallback((id: string) => {
    openImageInMain(id);
  }, [openImageInMain]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!uiSessionReady) return;
    let cancelled = false;
    void (async () => {
      const [gaps, session] = await Promise.all([
        refreshSetupState(),
        window.harness.uiSession.get(),
      ]);
      if (cancelled) return;
      if (shouldShowSetupNotice(gaps, session.setupNoticeDismissed === true)) {
        setSetupNoticeOpen(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uiSessionReady, refreshSetupState]);

  const runBackgroundSync = useCallback(async () => {
    const status = await window.harness.sync.getStatus();
    if (!status.configured) return;
    await window.harness.sync.runNow();
  }, []);

  useEffect(() => {
    void runBackgroundSync();
  }, [runBackgroundSync]);

  useEffect(() => {
    const onFocus = () => {
      void runBackgroundSync();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [runBackgroundSync]);

  useEffect(() => {
    const unsub = window.harness.sync.onChanged(() => {
      void refreshConversations();
    });
    return unsub;
  }, [refreshConversations]);

  useEffect(() => {
    const unsub = window.harness.notes.onOpenInMain((noteId) => {
      openNoteInMain(noteId);
    });
    return unsub;
  }, [openNoteInMain]);

  useEffect(() => {
    if (!uiSessionReady) return;
    const timer = window.setTimeout(() => {
      void window.harness.uiSession.set({
        view,
        conversationId,
        notesOpenNoteId: view === "notes" ? activeNoteId : null,
        imagesOpenImageId: view === "images" ? activeImageId : null,
        openNoteInStickyWindow,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [uiSessionReady, view, conversationId, activeNoteId, activeImageId, openNoteInStickyWindow]);

  useEffect(() => {
    const unsubTitle = window.harness.chat.onConversationTitleUpdated(() => {
      void refreshConversations();
    });
    const unsubAction = window.harness.chat.onDictationReplyActionUpdated(() => {
      void refreshConversations();
    });
    return () => {
      unsubTitle();
      unsubAction();
    };
  }, [refreshConversations]);

  const bumpTitleGen = useCallback((id: string, delta: 1 | -1) => {
    setTitleGenInFlight((prev) => {
      const n = (prev[id] ?? 0) + delta;
      const next = { ...prev };
      if (n <= 0) delete next[id];
      else next[id] = n;
      if (delta === -1 && n <= 0) {
        setTitleAwaitingIds((awaiting) => removeTitleAwaitingId(awaiting, id));
      }
      return next;
    });
  }, []);

  useEffect(() => {
    void window.harness.env.isHarnessE2E().then((v) => {
      harnessE2eRef.current = v;
    });
  }, []);

  useEffect(() => {
    const unsubStart = window.harness.chat.onTitleGenerationStarted((id) => bumpTitleGen(id, 1));
    const unsubEnd = window.harness.chat.onTitleGenerationEnded((id) => bumpTitleGen(id, -1));
    return () => {
      unsubStart();
      unsubEnd();
    };
  }, [bumpTitleGen]);

  /** Initial window focus should land in the chat composer, not a sidebar control. */
  useEffect(() => {
    setFocusComposerNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    window.harness.app.getVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  useEffect(() => {
    void window.harness.updater.getStatus().then(setUpdateStatus).catch(() => {});
    const unsub = window.harness.updater.onStatus(setUpdateStatus);
    void window.harness.updater.check();
    return unsub;
  }, []);

  const handleUpdateClick = useCallback(() => {
    if (updateStatus.status === "available") {
      void window.harness.updater.downloadAndInstall();
    }
  }, [updateStatus.status]);

  useEffect(() => {
    const normalizeLayout = (raw: LayoutOptions): LayoutOptions => ({
      sidebar: raw.sidebar === "right" ? "right" : "left",
      wideView: raw.wideView === "centered" ? "centered" : "scaled",
    });
    window.harness.customization.getLayoutOptions().then((raw) => setLayout(normalizeLayout(raw)));
    const unsub = window.harness.customization.onUpdated((p) => {
      if (p.type === "layout") {
        window.harness.customization.getLayoutOptions().then((raw) => setLayout(normalizeLayout(raw)));
      }
    });
    return unsub;
  }, []);

  const createNew = useCallback(async () => {
    setConversationId(null);
    setView("chat");
    setFocusComposerNonce((n) => n + 1);
  }, []);

  const createNewNote = useCallback(async () => {
    try {
      let templates = normalizeNoteTemplates(undefined);
      let defaultTemplateId = normalizeDefaultNoteTemplateId(undefined, templates);
      try {
        const settings = await window.harness.settings.get();
        templates = normalizeNoteTemplates(settings.notes?.templates);
        defaultTemplateId = normalizeDefaultNoteTemplateId(settings.notes?.defaultTemplateId, templates);
      } catch {
        // Fall back to built-in defaults when settings are unavailable.
      }
      const note = await window.harness.notes.create(
        undefined,
        getDefaultNoteTemplate(templates, defaultTemplateId).content,
      );
      setNotes((prev) =>
        [
          { id: note.id, title: note.title, updatedAt: note.updatedAt, createdAt: note.createdAt, wordCount: note.wordCount },
          ...prev,
        ].sort((a, b) => b.updatedAt - a.updatedAt)
      );
      if (openNoteInStickyWindow) {
        await window.harness.notes.openSticky(note.id);
        return;
      }
      openNoteInMain(note.id, { isNew: true });
    } catch (e) {
      console.error("Failed to create note", e);
    }
  }, [openNoteInStickyWindow, openNoteInMain]);

  const createNewImage = useCallback(() => {
    // Prompt-first: open a blank canvas; the library entry is created on first generate.
    setActiveImageId(null);
    setView("images");
  }, []);

  const handleAssignConversationId = useCallback((id: string) => {
    setConversationId(id);
    markTitleAwaiting(id);
    setConversations((prev) => {
      if (prev.some((c) => c.id === id)) {
        return prev.map((c) => (c.id === id ? { ...c, hasMessages: true } : c));
      }
      return [
        { id, title: null, createdAt: Date.now(), sessionKind: "chat", hasMessages: true },
        ...prev,
      ];
    });
  }, [markTitleAwaiting]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "n") return;
      e.preventDefault();
      if (e.shiftKey) {
        void createNewNote();
        return;
      }
      void createNew();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNew, createNewNote]);

  const handleConversationDelete = useCallback(async (id: string) => {
    await window.harness.memory.deleteConversation(id);
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    setTitleAwaitingIds((prev) => removeTitleAwaitingId(prev, id));
    setTitleGenInFlight((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (conversationId === id) {
      setConversationId(remaining.find(isSidebarVisibleConversation)?.id ?? null);
    }
  }, [conversationId, conversations]);

  const handleNoteDelete = useCallback(async (id: string) => {
    const remaining = await window.harness.notes.delete(id);
    setNotes(remaining);
    if (activeNoteId === id) {
      setActiveNoteId(null);
      setPendingOpenNoteRequest(null);
    }
  }, [activeNoteId]);

  const handleImageDelete = useCallback(async (id: string) => {
    const remaining = await window.harness.images.delete(id);
    setImages(remaining);
    if (activeImageId === id) {
      setActiveImageId(null);
    }
  }, [activeImageId]);

  const handleImageUpdated = useCallback((image: GeneratedImage) => {
    setImages((prev) =>
      [image, ...prev.filter((item) => item.id !== image.id)].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    );
    // First successful generate from the compose canvas selects the new entry.
    setActiveImageId((prev) => prev ?? image.id);
  }, []);

  const refreshLibraryAfterSync = useCallback(async () => {
    await Promise.all([refreshConversations(), loadNotesList(), loadImagesList()]);
  }, [refreshConversations, loadNotesList, loadImagesList]);

  useEffect(() => {
    wireGlobalHotkeyActions({
      setGlobalHotkeyOverlaySession,
      setGlobalHotkeyOverlayPhase,
      setGlobalHotkeyError,
      setView,
      setConversationId,
      setFocusComposerNonce,
      setPendingHotkeyText,
      setPendingHotkeyDraftOnly,
      setConversations,
      refreshConversations,
      markTitleAwaiting,
      getConversationId: () => conversationIdRef.current,
      getOverlaySession: () => overlaySessionRef.current,
    });
    return () => wireGlobalHotkeyActions(null);
  }, [markTitleAwaiting, refreshConversations, setGlobalHotkeyError]);

  useEffect(() => {
    // Auto-clear focused-path error chips only (overlay failed stays until dismiss).
    if (!globalHotkeyError || globalHotkeyOverlayPhase === "failed") return;
    const timer = window.setTimeout(() => setGlobalHotkeyError(null, null), 8000);
    return () => window.clearTimeout(timer);
  }, [globalHotkeyError, globalHotkeyOverlayPhase, setGlobalHotkeyError]);

  const sidebarConversations = useMemo(
    () => conversations.filter(isSidebarVisibleConversation),
    [conversations]
  );

  const activeChatConversation = useMemo(
    () => (conversationId ? conversations.find((c) => c.id === conversationId) ?? null : null),
    [conversations, conversationId]
  );

  const handleChatActivityChange = useCallback((active: boolean) => {
    setActiveChatProcessing(active);
  }, []);

  return (
    <div
      ref={appRef}
      className="app"
      data-sidebar={layout.sidebar}
      data-wide-view={layout.wideView}
      data-library-open={libraryOpen ? "true" : "false"}
      data-library-overlay={libraryHoverOpen && !libraryPinned ? "true" : "false"}
    >
      <div className="app-frame">
        <button
          type="button"
          className="library-backdrop"
          aria-label="Close library"
          aria-hidden={!(libraryHoverOpen && !libraryPinned)}
          tabIndex={libraryHoverOpen && !libraryPinned ? 0 : -1}
          onClick={closeLibraryIfUnpinned}
        />
        <Sidebar
          conversations={sidebarConversations}
          notes={notes}
          images={images}
          conversationId={conversationId}
          activeNoteId={activeNoteId}
          activeImageId={activeImageId}
          view={view}
          onViewChange={handleViewChange}
          onConversationSelect={handleConversationSelect}
          onConversationDelete={handleConversationDelete}
          onSelectNote={handleSelectNoteFromLibrary}
          onNoteDelete={handleNoteDelete}
          onSelectImage={handleSelectImageFromLibrary}
          onImageDelete={handleImageDelete}
          onNewChat={() => {
            void createNew();
            closeLibraryIfUnpinned();
          }}
          onNewNote={() => {
            void createNewNote();
            closeLibraryIfUnpinned();
          }}
          onNewImage={() => {
            void createNewImage();
            closeLibraryIfUnpinned();
          }}
          libraryPinned={libraryPinned}
          onToggleLibraryPinned={toggleLibraryPinned}
          activeChatProcessing={activeChatProcessing}
          titleGenInFlight={titleGenInFlight}
          titleAwaitingIds={titleAwaitingIds}
          appVersion={appVersion}
          updateStatus={updateStatus}
          onUpdateClick={handleUpdateClick}
          onSyncComplete={refreshLibraryAfterSync}
          onOpenDataSettings={openDataSettings}
          onLibraryPointerEnter={openLibraryHover}
          onLibraryPointerLeave={() => {
            if (!libraryPinned) scheduleLibraryHoverClose();
          }}
        />
        <main className="main">
          {(view === "chat" || activeChatProcessing) && (
            <div className="main-chat-host" hidden={view !== "chat"}>
              <ChatView
                conversationId={conversationId}
                displayTitle={
                  activeChatConversation
                    ? conversationDisplayTitle(
                        activeChatConversation.title,
                        activeChatConversation.createdAt
                      )
                    : ""
                }
                titlePending={
                  activeChatConversation != null &&
                  isConversationTitlePending(
                    activeChatConversation.title,
                    (titleGenInFlight[activeChatConversation.id] ?? 0) > 0 ||
                      !!titleAwaitingIds[activeChatConversation.id]
                  )
                }
                conversationChatMode={activeChatConversation?.chatMode}
                conversationDictationReplyAction={
                  activeChatConversation?.dictationReplyAction ?? null
                }
                onConversationCreated={refreshConversations}
                onAssignConversationId={handleAssignConversationId}
                pendingHotkeyText={pendingHotkeyText}
                pendingHotkeyDraftOnly={pendingHotkeyDraftOnly}
                onPendingHotkeyTextConsumed={() => {
                  setPendingHotkeyText(null);
                  setPendingHotkeyDraftOnly(false);
                }}
                onChatActivityChange={handleChatActivityChange}
                focusComposerNonce={focusComposerNonce}
                onOpenNotesView={(noteId) => openNoteInMain(noteId)}
                openAIConfigured={!setupStateLoaded || openAIConfigured}
                mirrorGlobalFnRecording={view === "chat"}
              />
            </div>
          )}
          {view === "settings" && (
            <SettingsView
              initialTab={settingsInitialTab}
              openNoteInStickyWindow={openNoteInStickyWindow}
              onOpenNoteInStickyWindowChange={setOpenNoteInStickyWindow}
              openAIConfigured={openAIConfigured}
              onSettingsChanged={() => {
                void refreshSetupState();
              }}
              onImportComplete={loadConversations}
              onSyncComplete={refreshLibraryAfterSync}
            />
          )}
          {view === "tasks" && <TasksView />}
          {view === "search" && (
            <SearchView
              notes={notes}
              images={images}
              conversationId={conversationId}
              activeNoteId={activeNoteId}
              activeImageId={activeImageId}
              onSelectConversation={handleConversationSelect}
              onSelectNote={handleSelectNoteFromLibrary}
              onSelectImage={handleSelectImageFromLibrary}
            />
          )}
          {view === "notes" && (
            <NotesView
              notes={notes}
              onNotesChange={setNotes}
              initialOpenNoteId={pendingOpenNoteRequest?.id ?? null}
              initialOpenNoteRequestNonce={pendingOpenNoteRequest?.nonce}
              initialOpenNoteIsNew={pendingOpenNoteRequest?.isNew}
              onInitialOpenNoteHandled={() => setPendingOpenNoteRequest(null)}
              onActiveNoteChange={setActiveNoteId}
            />
          )}
          {view === "images" && (
            <ImageCanvasView imageId={activeImageId} onImageUpdated={handleImageUpdated} />
          )}
        </main>
      </div>
      <SetupNoticeModal
        open={setupNoticeOpen && setupGaps.length > 0}
        gaps={setupGaps}
        onConfigure={openSettingsForGap}
        onDismiss={dismissSetupNotice}
      />
      <HotkeyRecordingOverlay
        phase={globalHotkeyOverlayPhase}
        error={globalHotkeyError}
        recordingPath={globalHotkeyRecordingPath}
        onRetry={() => {
          if (!globalHotkeyRecordingPath) return;
          setGlobalHotkeyOverlayPhase("transcribing");
          setGlobalHotkeyError(null, globalHotkeyRecordingPath);
          void window.harness.recording.retryGlobalTranscription(globalHotkeyRecordingPath);
        }}
        onShowInFinder={() => {
          if (!globalHotkeyRecordingPath) return;
          void window.harness.recording.showInFolder(globalHotkeyRecordingPath);
        }}
        onDismiss={() => {
          setGlobalHotkeyOverlaySession(false);
          setGlobalHotkeyOverlayPhase("idle");
          setGlobalHotkeyError(null, null);
        }}
      />
      {globalHotkeyError && globalHotkeyOverlayPhase === "idle" ? (
        <div className="hotkey-recording-overlay__error" data-testid="hotkey-recording-error" role="status">
          {globalHotkeyError}
        </div>
      ) : null}
    </div>
  );
}
