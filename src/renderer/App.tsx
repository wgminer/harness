import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { ChatView } from "./ChatView";
import { AppTitlebar } from "./AppTitlebar";
import { getCachedSettings, setCachedAccessibilityTrusted, setCachedHasOpenAIApiKey, setCachedSettings } from "./settings/settingsSessionCache";
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
import type { Conversation, View, DevView } from "./sidebarUtils";
import { isDevView } from "./sidebarUtils";

/**
 * Only the chat view is on the boot path. Lazy-loading the rest keeps CodeMirror
 * (notes) and the QR encoder (settings sync) out of the initial chunk.
 */
const SettingsView = lazy(() =>
  import("./SettingsView").then((m) => ({ default: m.SettingsView })),
);
const TasksView = lazy(() => import("./TasksView").then((m) => ({ default: m.TasksView })));
const SearchView = lazy(() => import("./SearchView").then((m) => ({ default: m.SearchView })));
const NotesView = lazy(() =>
  import("./WritingSurfaceView").then((m) => ({ default: m.NotesView })),
);
const ImageCanvasView = lazy(() =>
  import("./ImageCanvasView").then((m) => ({ default: m.ImageCanvasView })),
);

/** Folds to `null` in production builds, so the playground never ships. */
const DevViewHost = import.meta.env.DEV ? lazy(() => import("./dev/DevViewHost")) : null;
import {
  collectSetupGaps,
  shouldShowSetupNotice,
  type SetupGap,
} from "../shared/setupState";
import { SETTINGS_PAGE_TITLE } from "../shared/settingsPage";
import type { SettingsTabId } from "./settings/settingsNavConfig";
import { IDLE_UPDATE_STATUS, type UpdateStatus } from "../shared/updateStatus";
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
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [isHarnessDev, setIsHarnessDev] = useState(false);

  const toggleLibraryOpen = useCallback(() => {
    setLibraryOpen((open) => !open);
  }, []);

  const [pendingHotkeyText, setPendingHotkeyText] = useState<string | null>(null);
  /** When true, hotkey text is always pre-filled (never auto-sent). Used for global recording while the app was unfocused. */
  const [pendingHotkeyDraftOnly, setPendingHotkeyDraftOnly] = useState(false);
  const [pendingNoteHotkeyText, setPendingNoteHotkeyText] = useState<string | null>(null);
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
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  const activeNoteIdRef = useRef(activeNoteId);
  useEffect(() => { activeNoteIdRef.current = activeNoteId; }, [activeNoteId]);
  useEffect(() => {
    overlaySessionRef.current = globalHotkeyOverlaySession;
  }, [globalHotkeyOverlaySession]);

  /**
   * `refreshSettingsCache` is only needed when settings may have changed — the
   * gap computation itself doesn't read settings, and boot already primed the
   * cache in main.tsx.
   */
  const refreshSetupState = useCallback(async (refreshSettingsCache = false) => {
    const [syncStatus, credentialStatus, platform] = await Promise.all([
      window.harness.sync.getStatus(),
      window.harness.credentials.getStatus(),
      window.harness.system.getPlatform(),
      refreshSettingsCache
        ? (window.harness.settings.get() as Promise<Settings>).then(setCachedSettings)
        : Promise.resolve(),
    ]);
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
      void refreshSetupState(true);
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
    // main.tsx primes the settings cache during boot; only read again if that
    // hasn't landed yet (the two race).
    const cachedSettings = getCachedSettings();
    const [list, session, settings] = await Promise.all([
      window.harness.memory.listConversations(),
      window.harness.uiSession.get(),
      cachedSettings ?? window.harness.settings.get(),
    ]);
    if (!cachedSettings) setCachedSettings(settings);
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
    void window.harness.env.isHarnessDev().then(setIsHarnessDev);
  }, []);

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
        view: isDevView(view) ? "chat" : view,
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
      setPendingNoteHotkeyText,
      setConversations,
      refreshConversations,
      markTitleAwaiting,
      getConversationId: () => conversationIdRef.current,
      getView: () => viewRef.current,
      getActiveNoteId: () => activeNoteIdRef.current,
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

  const handleDevViewSelect = useCallback((devView: DevView) => {
    setView(devView);
  }, []);

  const pageTitle = useMemo(() => {
    switch (view) {
      case "chat":
        return activeChatConversation
          ? conversationDisplayTitle(
              activeChatConversation.title,
              activeChatConversation.createdAt
            )
          : "New Chat";
      case "dev-chat":
        return "Dev · Chat";
      case "dev-dictation":
        return "Dev · Dictation";
      case "dev-note":
        return "Dev · Note";
      case "dev-image":
        return "Dev · Image";
      case "notes":
        return "Notes";
      case "images":
        return "Images";
      case "tasks":
        return "Tasks";
      case "search":
        return "Search";
      case "settings":
        return SETTINGS_PAGE_TITLE;
    }
  }, [view, activeChatConversation]);

  return (
    <div
      className="app"
      data-sidebar={layout.sidebar}
      data-library-open={libraryOpen ? "true" : "false"}
    >
      <AppTitlebar
        libraryOpen={libraryOpen}
        onToggleLibrary={toggleLibraryOpen}
        view={view}
        onViewChange={handleViewChange}
        title={pageTitle}
      />
      <div className="app-frame">
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
          }}
          onNewNote={() => {
            void createNewNote();
          }}
          onNewImage={() => {
            void createNewImage();
          }}
          activeChatProcessing={activeChatProcessing}
          titleGenInFlight={titleGenInFlight}
          titleAwaitingIds={titleAwaitingIds}
          appVersion={appVersion}
          updateStatus={updateStatus}
          onUpdateClick={handleUpdateClick}
          onSyncComplete={refreshLibraryAfterSync}
          onOpenDataSettings={openDataSettings}
          showDevSection={isHarnessDev}
          onDevViewSelect={handleDevViewSelect}
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
                conversationCreatedAt={activeChatConversation?.createdAt ?? null}
                conversationSessionKind={activeChatConversation?.sessionKind ?? null}
                conversationHasAssistantReply={
                  activeChatConversation?.hasAssistantReply === true
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
                onNotesChanged={() => {
                  void loadNotesList();
                }}
                openAIConfigured={!setupStateLoaded || openAIConfigured}
                mirrorGlobalFnRecording={view === "chat"}
              />
            </div>
          )}
          <Suspense fallback={null}>
          {view === "settings" && (
            <SettingsView
              initialTab={settingsInitialTab}
              openNoteInStickyWindow={openNoteInStickyWindow}
              onOpenNoteInStickyWindowChange={setOpenNoteInStickyWindow}
              openAIConfigured={openAIConfigured}
              onSettingsChanged={() => {
                void refreshSetupState(true);
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
              pendingHotkeyText={pendingNoteHotkeyText}
              onPendingHotkeyTextConsumed={() => setPendingNoteHotkeyText(null)}
              mirrorGlobalFnRecording={view === "notes"}
            />
          )}
          {view === "images" && (
            <ImageCanvasView imageId={activeImageId} onImageUpdated={handleImageUpdated} />
          )}
          {DevViewHost && isDevView(view) ? <DevViewHost view={view} /> : null}
          </Suspense>
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
