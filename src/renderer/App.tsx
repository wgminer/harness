import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChatView } from "./ChatView";
import { SettingsView } from "./SettingsView";
import { TasksView } from "./TasksView";
import { NotesView } from "./WritingSurfaceView";
import { Sidebar } from "./Sidebar";
import { SetupNoticeModal } from "./SetupNoticeModal";
import { HotkeyRecordingOverlay } from "./HotkeyRecordingOverlay";
import { wireGlobalHotkeyActions } from "./globalHotkeyController";
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, type LayoutOptions, type Plan, type Settings } from "../shared/types";
import { DEFAULT_UI_SESSION } from "../shared/uiSession";
import type {} from "../shared/desktopAPI";
import { isSidebarVisibleConversation } from "../shared/conversationSession";
import { conversationDisplayTitle, isConversationTitlePending } from "./chatDisplayTitle";
import type { Conversation, View } from "./sidebarUtils";
import { useViewportLayout } from "./useViewportLayout";
import { isGlobalFnRecordingEnabledForView } from "../shared/globalFnRecording";
import {
  collectSetupGaps,
  shouldShowSetupNotice,
  type SetupGap,
} from "../shared/setupState";
import type { SettingsTabId } from "./settings/settingsNavConfig";
import { IDLE_UPDATE_STATUS, type UpdateStatus } from "../shared/updateStatus";

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [layout, setLayout] = useState<LayoutOptions>(DEFAULT_LAYOUT);
  const { presetSmall } = useViewportLayout();
  /** Incremented when entering small window on chat so ChatView focuses the composer. */
  const [focusComposerNonce, setFocusComposerNonce] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>(IDLE_UPDATE_STATUS);
  /** True while the open chat is waiting on / streaming from the chat model (not composer voice). */
  const [activeChatProcessing, setActiveChatProcessing] = useState(false);
  /** Per-conversation refcount for async LLM thread title generation after a reply. */
  const [titleGenInFlight, setTitleGenInFlight] = useState<Record<string, number>>({});
  /** Note id to open when entering Notes from chat message action. */
  const [pendingOpenNoteRequest, setPendingOpenNoteRequest] = useState<{
    id: string;
    nonce: number;
  } | null>(null);
  const [notesScreen, setNotesScreen] = useState<"list" | "detail">("list");
  const [activeNoteId, setActiveNoteId] = useState<string | null>(null);
  const [notesOverviewNonce, setNotesOverviewNonce] = useState(0);
  const [uiSessionReady, setUiSessionReady] = useState(false);
  const [setupGaps, setSetupGaps] = useState<SetupGap[]>([]);
  const [setupNoticeOpen, setSetupNoticeOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId | undefined>();
  const [openAIConfigured, setOpenAIConfigured] = useState(false);
  const [setupStateLoaded, setSetupStateLoaded] = useState(false);
  const [openNoteInStickyWindow, setOpenNoteInStickyWindow] = useState(
    DEFAULT_UI_SESSION.openNoteInStickyWindow ?? false,
  );

  const [pendingHotkeyText, setPendingHotkeyText] = useState<string | null>(null);
  /** When true, hotkey text is always pre-filled (never auto-sent). Used for global recording while the app was unfocused. */
  const [pendingHotkeyDraftOnly, setPendingHotkeyDraftOnly] = useState(false);
  const [globalHotkeyRecording, setGlobalHotkeyRecording] = useState(false);
  const [globalHotkeyError, setGlobalHotkeyError] = useState<string | null>(null);

  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  const refreshSetupState = useCallback(async () => {
    const [settings, syncStatus, credentialStatus, platform] = await Promise.all([
      window.harness.settings.get() as Promise<Settings>,
      window.harness.sync.getStatus(),
      window.harness.credentials.getStatus(),
      window.harness.system.getPlatform(),
    ]);
    let accessibilityTrusted: boolean | null = null;
    if (platform === "darwin") {
      accessibilityTrusted = await window.harness.system.macosAccessibilityTrusted();
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
      void refreshSetupState();
    }
    prevViewRef.current = view;
  }, [view, refreshSetupState]);

  const openSettingsForGap = useCallback((gap: SetupGap) => {
    setSettingsInitialTab(gap.settingsTab);
    setView("settings");
    setSetupNoticeOpen(false);
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

  const loadPlans = useCallback(async () => {
    const list = await window.harness.plans.list();
    setPlans(list);
  }, []);

  const loadConversations = useCallback(async () => {
    const [list, session, settings] = await Promise.all([
      window.harness.memory.listConversations(),
      window.harness.uiSession.get(),
      window.harness.settings.get(),
    ]);
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
      setOpenNoteInStickyWindow(session.openNoteInStickyWindow === true);
    }
    setUiSessionReady(true);
  }, [resolveConversationId]);

  /** Reload sidebar list after sync/import without resetting view from session. */
  const refreshConversations = useCallback(async () => {
    const list = await window.harness.memory.listConversations();
    setConversations(list);
    setConversationId((current) => resolveConversationId(list, current));
  }, [resolveConversationId]);

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
    if (!uiSessionReady) return;
    const timer = window.setTimeout(() => {
      void window.harness.uiSession.set({
        view,
        conversationId,
        notesOpenNoteId: view === "notes" && notesScreen === "detail" ? activeNoteId : null,
        openNoteInStickyWindow,
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [uiSessionReady, view, conversationId, notesScreen, activeNoteId, openNoteInStickyWindow]);

  useEffect(() => {
    const unsub = window.harness.chat.onConversationTitleUpdated(() => {
      void refreshConversations();
    });
    return unsub;
  }, [refreshConversations]);

  const bumpTitleGen = useCallback((id: string, delta: 1 | -1) => {
    setTitleGenInFlight((prev) => {
      const n = (prev[id] ?? 0) + delta;
      const next = { ...prev };
      if (n <= 0) delete next[id];
      else next[id] = n;
      return next;
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

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  /** Initial window focus should land in the chat composer, not the sidebar search toggle. */
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
    window.harness.customization.getLayoutOptions().then(setLayout);
    const unsub = window.harness.customization.onUpdated((p) => {
      if (p.type === "layout") {
        window.harness.customization.getLayoutOptions().then(setLayout);
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
      const note = await window.harness.notes.create(undefined, "# Note\n");
      if (openNoteInStickyWindow) {
        await window.harness.notes.openSticky(note.id);
        return;
      }
      setPendingOpenNoteRequest({ id: note.id, nonce: Date.now() });
      setView("notes");
    } catch (e) {
      console.error("Failed to create note", e);
    }
  }, [openNoteInStickyWindow]);

  const handleAssignConversationId = useCallback((id: string) => {
    setConversationId(id);
    setConversations((prev) => {
      if (prev.some((c) => c.id === id)) {
        return prev.map((c) => (c.id === id ? { ...c, hasMessages: true } : c));
      }
      return [
        { id, title: null, createdAt: Date.now(), sessionKind: "chat", hasMessages: true },
        ...prev,
      ];
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void createNew();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNew]);

  const handleWindowSizeToggle = useCallback(async () => {
    await window.harness.windowSize.toggle();
  }, []);

  const handleConversationDelete = useCallback(async (id: string) => {
    await window.harness.memory.deleteConversation(id);
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (conversationId === id) {
      setConversationId(remaining.find(isSidebarVisibleConversation)?.id ?? null);
    }
  }, [conversationId, conversations]);

  const handleNotesClick = useCallback(() => {
    setPendingOpenNoteRequest(null);
    setActiveNoteId(null);
    setNotesOverviewNonce((n) => n + 1);
    setView("notes");
  }, []);

  useEffect(() => {
    void window.harness.recording.setGlobalEnabled(isGlobalFnRecordingEnabledForView(view));
  }, [view]);

  useEffect(() => {
    wireGlobalHotkeyActions({
      setGlobalHotkeyRecording,
      setGlobalHotkeyError,
      setView,
      setConversationId,
      setFocusComposerNonce,
      setPendingHotkeyText,
      setPendingHotkeyDraftOnly,
      setConversations,
      loadConversations,
      getConversationId: () => conversationIdRef.current,
    });
    return () => wireGlobalHotkeyActions(null);
  }, [loadConversations]);

  useEffect(() => {
    if (!globalHotkeyError) return;
    const timer = window.setTimeout(() => setGlobalHotkeyError(null), 8000);
    return () => window.clearTimeout(timer);
  }, [globalHotkeyError]);

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

  // Suppress unused variable warning for plans/expandedPlanId until plan UI is added
  void plans;
  void expandedPlanId;
  void presetSmall;

  return (
    <div className="app" data-sidebar={layout.sidebar}>
      <Sidebar
        conversations={sidebarConversations}
        conversationId={conversationId}
        view={view}
        onViewChange={setView}
        onConversationSelect={setConversationId}
        onConversationDelete={handleConversationDelete}
        onNewChat={createNew}
        onNewNote={() => void createNewNote()}
        openNoteInStickyWindow={openNoteInStickyWindow}
        onOpenNoteInStickyWindowChange={setOpenNoteInStickyWindow}
        activeChatProcessing={activeChatProcessing}
        titleGenInFlight={titleGenInFlight}
        appVersion={appVersion}
        updateStatus={updateStatus}
        onUpdateClick={handleUpdateClick}
        notesItemActive={view === "notes" && notesScreen === "list"}
        onNotesClick={handleNotesClick}
        onSyncComplete={refreshConversations}
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
                  (titleGenInFlight[activeChatConversation.id] ?? 0) > 0
                )
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
              onWindowSizeToggle={handleWindowSizeToggle}
              onOpenNotesView={(noteId) => {
                setPendingOpenNoteRequest({ id: noteId, nonce: Date.now() });
                setView("notes");
              }}
              openAIConfigured={!setupStateLoaded || openAIConfigured}
            />
          </div>
        )}
        {view === "settings" && (
          <SettingsView
            initialTab={settingsInitialTab}
            onSettingsChanged={() => {
              void refreshSetupState();
            }}
            onImportComplete={loadConversations}
            onSyncComplete={refreshConversations}
          />
        )}
        {view === "tasks" && <TasksView />}
        {view === "notes" && (
          <NotesView
            initialOpenNoteId={pendingOpenNoteRequest?.id ?? null}
            initialOpenNoteRequestNonce={pendingOpenNoteRequest?.nonce}
            onInitialOpenNoteHandled={() => setPendingOpenNoteRequest(null)}
            resetToOverviewNonce={notesOverviewNonce}
            onScreenChange={setNotesScreen}
            onActiveNoteChange={setActiveNoteId}
          />
        )}
      </main>
      {layout.gridOverlay !== "off" && (
        <div
          className="app-grid-overlay"
          data-grid-overlay={layout.gridOverlay}
          data-testid="app-grid-overlay"
          aria-hidden
        />
      )}
      <SetupNoticeModal
        open={setupNoticeOpen && setupGaps.length > 0}
        gaps={setupGaps}
        onConfigure={openSettingsForGap}
        onDismiss={dismissSetupNotice}
      />
      <HotkeyRecordingOverlay active={globalHotkeyRecording} error={globalHotkeyError} />
    </div>
  );
}
