import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChatView } from "./ChatView";
import { ChatLayoutDebugHost } from "./layoutDebug/ChatLayoutDebugHost";
import { AppTitlebar } from "./AppTitlebar";
import { SettingsView } from "./SettingsView";
import { setCachedAccessibilityTrusted, setCachedHasOpenAIApiKey, setCachedSettings } from "./settings/settingsSessionCache";
import { TasksView } from "./TasksView";
import { SearchView } from "./SearchView";
import { NotesView } from "./WritingSurfaceView";
import { ImageCanvasView } from "./ImageCanvasView";
import { Sidebar } from "./Sidebar";
import { DevChatView, DevDictationView, DevPlaceholderView } from "./dev/devPlayground";
import { SetupNoticeModal } from "./SetupNoticeModal";
import { HotkeyRecordingOverlay } from "./HotkeyRecordingOverlay";
import { wireGlobalHotkeyActions, type GlobalHotkeyOverlayPhase } from "./globalHotkeyController";
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, type LayoutOptions, type Settings } from "../shared/types";
import { DEFAULT_UI_SESSION } from "../shared/uiSession";
import type {} from "../shared/desktopAPI";
import { isSidebarVisibleConversation, isTimePlaceholderTitle } from "../shared/conversationSession";
import {
  getDefaultNoteTemplate,
  getDisplayNoteTitle,
  normalizeDefaultNoteTemplateId,
  normalizeNoteTemplates,
  type NoteSummary,
} from "../shared/writing";
import type { GeneratedImage } from "../shared/images";
import { conversationDisplayTitle, isConversationTitlePending } from "./chatDisplayTitle";
import type { Conversation, View, DevView } from "./sidebarUtils";
import { isDevView } from "./sidebarUtils";
import {
  collectSetupGaps,
  shouldShowSetupNotice,
  type SetupGap,
} from "../shared/setupState";
import { SETTINGS_PAGE_TITLE } from "../shared/settingsPage";
import {
  arrivedLibraryIds as collectArrivedLibraryIds,
  consumeArrivalId,
  mergeArrivalTimes,
  pruneArrivalTimes,
  snapshotLibraryFingerprints,
} from "../shared/libraryArrival";
import type { SettingsTabId } from "./settings/settingsNavConfig";
import { canStartUpdate, IDLE_UPDATE_STATUS, type UpdateStatus } from "../shared/updateStatus";
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
  /** Incremented when the window title is clicked to open conversation details. */
  const [openTitleModalNonce, setOpenTitleModalNonce] = useState(0);
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
  /** Image ids with generate/adjust in flight — sidebar spinner + keep canvas mounted. */
  const [processingImageIds, setProcessingImageIds] = useState<Record<string, true>>({});
  const activeImageProcessing = Object.keys(processingImageIds).length > 0;
  const [uiSessionReady, setUiSessionReady] = useState(false);
  const [setupGaps, setSetupGaps] = useState<SetupGap[]>([]);
  const [setupNoticeOpen, setSetupNoticeOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId | undefined>();
  const [openAIConfigured, setOpenAIConfigured] = useState(false);
  const [webClient, setWebClient] = useState(false);
  const [setupStateLoaded, setSetupStateLoaded] = useState(false);
  const [openNoteInStickyWindow, setOpenNoteInStickyWindow] = useState(
    DEFAULT_UI_SESSION.openNoteInStickyWindow ?? false,
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  /** Ids pulled/merged from R2 in this session — faded “arrived” mark in the library. */
  const [arrivedLibraryIds, setArrivedLibraryIds] = useState<Record<string, number>>({});

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
  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  const notesRef = useRef(notes);
  useEffect(() => { notesRef.current = notes; }, [notes]);
  const imagesRef = useRef(images);
  useEffect(() => { imagesRef.current = images; }, [images]);
  useEffect(() => {
    overlaySessionRef.current = globalHotkeyOverlaySession;
  }, [globalHotkeyOverlaySession]);

  const refreshSetupState = useCallback(async () => {
    const [settings, syncStatus, credentialStatus, platform, webClient] = await Promise.all([
      window.harness.settings.get() as Promise<Settings>,
      window.harness.sync.getStatus(),
      window.harness.credentials.getStatus(),
      window.harness.system.getPlatform(),
      window.harness.env.isHarnessWeb(),
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
    setWebClient(webClient);
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
    setArrivedLibraryIds((prev) => consumeArrivalId(prev, id));
    setConversationId(id);
    setView("chat");
  }, []);

  const openDataSettings = useCallback(() => {
    setSettingsInitialTab("data");
    setView("settings");
  }, []);

  const dismissSetupNotice = useCallback(() => {
    setSetupNoticeOpen(false);
  }, []);

  const saveSetupApiKey = useCallback(
    async (apiKey: string) => {
      await window.harness.credentials.setOpenAIApiKey(apiKey);
      setCachedHasOpenAIApiKey(true);
      await refreshSetupState();
      setSetupNoticeOpen(false);
      void window.harness.uiSession.set({ setupNoticeDismissed: true });
    },
    [refreshSetupState],
  );
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

  const refreshLibraryAfterSync = useCallback(async () => {
    const before = snapshotLibraryFingerprints({
      conversations: conversationsRef.current,
      notes: notesRef.current,
      images: imagesRef.current,
    });
    const [list, noteList, imageList] = await Promise.all([
      window.harness.memory.listConversations(),
      window.harness.notes.list(),
      window.harness.images.list(),
    ]);
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
    setNotes(noteList);
    setImages(imageList);
    const after = snapshotLibraryFingerprints({
      conversations: list,
      notes: noteList,
      images: imageList,
    });
    const arrived = collectArrivedLibraryIds(before, after);
    if (arrived.length === 0) {
      setArrivedLibraryIds((prev) => pruneArrivalTimes(prev));
      return;
    }
    setArrivedLibraryIds((prev) => mergeArrivalTimes(prev, arrived));
  }, [resolveConversationId]);

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
    setArrivedLibraryIds((prev) => consumeArrivalId(prev, id));
    openNoteInMain(id);
  }, [openNoteInMain]);

  const handleSelectImageFromLibrary = useCallback((id: string) => {
    setArrivedLibraryIds((prev) => consumeArrivalId(prev, id));
    openImageInMain(id);
  }, [openImageInMain]);

  const handleInitialOpenNoteHandled = useCallback(() => {
    setPendingOpenNoteRequest(null);
  }, []);

  const handlePendingNoteHotkeyTextConsumed = useCallback(() => {
    setPendingNoteHotkeyText(null);
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
      void refreshLibraryAfterSync();
    });
    return unsub;
  }, [refreshLibraryAfterSync]);

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
    return window.harness.updater.onStatus(setUpdateStatus);
  }, []);

  const handleUpdateClick = useCallback(() => {
    if (!canStartUpdate(updateStatus)) return;
    void window.harness.updater.downloadAndInstall().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setUpdateStatus({ status: "error", message: message || "Update failed" });
    });
  }, [updateStatus]);

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
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        if (e.shiftKey) {
          void createNewNote();
          return;
        }
        void createNew();
        return;
      }
      if (key === "i" && e.shiftKey) {
        e.preventDefault();
        createNewImage();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNew, createNewNote, createNewImage]);

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
    setProcessingImageIds((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (activeImageId === id) {
      setActiveImageId(null);
    }
  }, [activeImageId]);

  const handleImageRemoved = useCallback((id: string) => {
    setImages((prev) => prev.filter((item) => item.id !== id));
    setProcessingImageIds((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
    // Create-on-submit (and first generate) selects the new library entry.
    setActiveImageId((prev) => prev ?? image.id);
  }, []);

  const handleImageActivityChange = useCallback((imageId: string, active: boolean) => {
    setProcessingImageIds((prev) => {
      if (active) {
        return prev[imageId] ? prev : { ...prev, [imageId]: true };
      }
      if (!prev[imageId]) return prev;
      const next = { ...prev };
      delete next[imageId];
      return next;
    });
  }, []);

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
      setActiveNoteId,
      getOverlaySession: () => overlaySessionRef.current,
    });
    return () => wireGlobalHotkeyActions(null);
  }, [markTitleAwaiting, refreshConversations, setActiveNoteId, setGlobalHotkeyError]);

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

  const chatTitlePending =
    view === "chat" &&
    activeChatConversation != null &&
    isConversationTitlePending(
      activeChatConversation.title,
      (titleGenInFlight[activeChatConversation.id] ?? 0) > 0 ||
        !!titleAwaitingIds[activeChatConversation.id],
    );

  const openChatTitleModal = useCallback(() => {
    setOpenTitleModalNonce((n) => n + 1);
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
      case "notes": {
        const activeNote = notes.find((note) => note.id === activeNoteId);
        if (!activeNote) return "Notes";
        return getDisplayNoteTitle(activeNote.title ?? "") || "Notes";
      }
      case "images":
        return "Images";
      case "tasks":
        return "Tasks";
      case "search":
        return "Search";
      case "settings":
        return SETTINGS_PAGE_TITLE;
    }
  }, [view, activeChatConversation, notes, activeNoteId]);

  return (
    <div
      className="app"
      data-sidebar={layout.sidebar}
      data-library-open={libraryOpen ? "true" : "false"}
    >
      <AppTitlebar
        libraryOpen={libraryOpen}
        onToggleLibrary={toggleLibraryOpen}
        title={pageTitle}
        titlePending={chatTitlePending}
        onTitleClick={
          view === "chat" && conversationId ? openChatTitleModal : undefined
        }
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
          processingImageIds={processingImageIds}
          titleGenInFlight={titleGenInFlight}
          titleAwaitingIds={titleAwaitingIds}
          appVersion={appVersion}
          updateStatus={updateStatus}
          onUpdateClick={handleUpdateClick}
          onSyncComplete={refreshLibraryAfterSync}
          onOpenDataSettings={openDataSettings}
          showDevSection={false}
          onDevViewSelect={handleDevViewSelect}
          arrivedLibraryIds={arrivedLibraryIds}
        />
        <main className="main">
          {(view === "chat" || activeChatProcessing) && (
            <div className="main-chat-host" hidden={view !== "chat"}>
              <ChatLayoutDebugHost active={view === "chat"}>
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
                  openTitleModalNonce={openTitleModalNonce}
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
                  onOpenConversation={(id) => {
                    setConversationId(id);
                    setView("chat");
                  }}
                  onOpenImage={(imageId) => openImageInMain(imageId)}
                  onNotesChanged={() => {
                    void loadNotesList();
                  }}
                  openAIConfigured={!setupStateLoaded || openAIConfigured || webClient}
                  mirrorGlobalFnRecording={view === "chat"}
                />
              </ChatLayoutDebugHost>
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
              onInitialOpenNoteHandled={handleInitialOpenNoteHandled}
              onActiveNoteChange={setActiveNoteId}
              pendingHotkeyText={pendingNoteHotkeyText}
              onPendingHotkeyTextConsumed={handlePendingNoteHotkeyTextConsumed}
              mirrorGlobalFnRecording={view === "notes"}
            />
          )}
          {(view === "images" || activeImageProcessing || activeImageId != null) && (
            <div className="main-image-host" hidden={view !== "images"}>
              <ImageCanvasView
                imageId={activeImageId}
                onImageUpdated={handleImageUpdated}
                onImageRemoved={handleImageRemoved}
                onImageActivityChange={handleImageActivityChange}
              />
            </div>
          )}
          {view === "dev-chat" && <DevChatView />}
          {view === "dev-dictation" && <DevDictationView />}
          {view === "dev-note" && <DevPlaceholderView kind="note" />}
          {view === "dev-image" && <DevPlaceholderView kind="image" />}
        </main>
      </div>
      <SetupNoticeModal
        open={setupNoticeOpen && setupGaps.some((gap) => gap.severity === "required")}
        onSaveApiKey={saveSetupApiKey}
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
