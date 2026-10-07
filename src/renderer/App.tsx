import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChatView } from "./chat/ChatView";
import type { ComposerDraft } from "./chat/useChatComposer";
import { ChatLayoutDebugHost } from "./layoutDebug/ChatLayoutDebugHost";
import { AppTitlebar } from "./AppTitlebar";
import { SidebarTitlebarActions, TitlebarSettingsButton } from "./sidebar/SidebarTitlebarActions";
import { SettingsView } from "./settings/SettingsView";
import { setCachedSettings } from "./settings/settingsSessionCache";
import { TasksView } from "./tasks/TasksView";
import { SearchPalette } from "./search/SearchPalette";
import { NotesView } from "./notes/WritingSurfaceView";
import { ImageCanvasView } from "./images/ImageCanvasView";
import { Sidebar } from "./sidebar/Sidebar";
import { DevChatView, DevDictationView, DevPlaceholderView } from "./dev/devPlayground";
import { SetupNoticeModal } from "./setup/SetupNoticeModal";
import { HotkeyRecordingOverlay } from "./recording/HotkeyRecordingOverlay";
import { wireGlobalHotkeyActions } from "./recording/globalHotkeyController";
import { useGlobalHotkeyOverlay } from "./recording/useGlobalHotkeyOverlay";
import { useConversationTitles } from "./chat/useConversationTitles";
import { resolveConversationId, useConversations } from "./chat/useConversations";
import { useNotesLibrary } from "./notes/useNotesLibrary";
import { useImageLibrary } from "./images/useImageLibrary";
import { useSetupState } from "./setup/useSetupState";
import { useLibraryArrivals } from "./sidebar/useLibraryArrivals";
import { useUpdater } from "./hooks/useUpdater";
import { useLayoutOptions } from "./hooks/useLayoutOptions";
import { useBackgroundSync } from "./hooks/useBackgroundSync";
import { DEFAULT_SETTINGS } from "../shared/types";
import { DEFAULT_UI_SESSION } from "../shared/uiSession";
import type {} from "../shared/desktopAPI";
import { getDisplayNoteTitle } from "../shared/writing";
import { conversationDisplayTitle, isConversationTitlePending } from "./chat/chatDisplayTitle";
import type { View, DevView } from "./sidebar/sidebarUtils";
import { isDevView } from "./sidebar/sidebarUtils";
import { SETTINGS_PAGE_TITLE } from "../shared/settingsPage";
import { snapshotLibraryFingerprints } from "../shared/libraryArrival";
import type { SettingsTabId } from "./settings/settingsNavConfig";

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [searchOpen, setSearchOpen] = useState(false);
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);
  /** Incremented when the chat composer should be focused. */
  const [focusComposerNonce, setFocusComposerNonce] = useState(0);
  /** Incremented when the window title is clicked to open conversation details. */
  const [openTitleModalNonce, setOpenTitleModalNonce] = useState(0);
  /** True while the open chat is waiting on / streaming from the chat model (not composer voice). */
  const [activeChatProcessing, setActiveChatProcessing] = useState(false);
  const [uiSessionReady, setUiSessionReady] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId | undefined>();
  const [openNoteInStickyWindow, setOpenNoteInStickyWindow] = useState(
    DEFAULT_UI_SESSION.openNoteInStickyWindow ?? false,
  );
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [pendingHotkeyText, setPendingHotkeyText] = useState<string | null>(null);
  /** When true, hotkey text is always pre-filled (never auto-sent). Used for global recording while the app was unfocused. */
  const [pendingHotkeyDraftOnly, setPendingHotkeyDraftOnly] = useState(false);
  const [composerDraft, setComposerDraft] = useState<ComposerDraft | null>(null);
  const [pendingNoteHotkeyText, setPendingNoteHotkeyText] = useState<string | null>(null);

  const layout = useLayoutOptions();
  const { appVersion, updateStatus, startUpdate } = useUpdater();
  const titles = useConversationTitles();
  const chats = useConversations(titles);
  const notesLib = useNotesLibrary({ setView, openNoteInStickyWindow });
  const imagesLib = useImageLibrary({ setView });
  const setup = useSetupState({ uiSessionReady });
  const arrivals = useLibraryArrivals();
  const hotkey = useGlobalHotkeyOverlay();

  const {
    conversationId,
    setConversationId,
    setConversations,
    conversationsRef,
    conversationIdRef,
    activeChatConversation,
    applyConversationList,
    refreshConversations,
  } = chats;
  const {
    notes,
    setNotes,
    notesRef,
    activeNoteId,
    setActiveNoteId,
    activeNoteIdRef,
    setPendingOpenNoteRequest,
    openNoteInMain,
    createNewNote,
    loadNotesList,
    noteReturnTo,
  } = notesLib;
  const { images, setImages, imagesRef, activeImageId, setActiveImageId, openImageInMain, createNewImage } =
    imagesLib;
  const { refreshSetupState } = setup;
  const { consumeArrival, recordArrivals } = arrivals;
  const { markTitleAwaiting } = titles;

  const toggleLibraryOpen = useCallback(() => {
    setLibraryOpen((open) => !open);
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

  const closeSearch = useCallback(() => setSearchOpen(false), []);

  const handleConversationSelect = useCallback((id: string) => {
    consumeArrival(id);
    setConversationId(id);
    setView("chat");
  }, [consumeArrival, setConversationId]);

  const handleSelectNoteFromLibrary = useCallback((id: string) => {
    consumeArrival(id);
    openNoteInMain(id);
  }, [consumeArrival, openNoteInMain]);

  const handleSelectImageFromLibrary = useCallback((id: string) => {
    consumeArrival(id);
    openImageInMain(id);
  }, [consumeArrival, openImageInMain]);

  /** Restore the last view (or open to compose) from the persisted UI session. */
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
  }, [setConversations, setConversationId, setPendingOpenNoteRequest, setActiveImageId]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

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
    applyConversationList(list);
    setNotes(noteList);
    setImages(imageList);
    recordArrivals(
      before,
      snapshotLibraryFingerprints({ conversations: list, notes: noteList, images: imageList }),
    );
  }, [
    applyConversationList,
    conversationsRef,
    notesRef,
    setNotes,
    imagesRef,
    setImages,
    recordArrivals,
  ]);

  const handleSyncChanged = useCallback(() => {
    void refreshLibraryAfterSync();
    void refreshSetupState();
  }, [refreshLibraryAfterSync, refreshSetupState]);
  useBackgroundSync(handleSyncChanged);

  /** Initial window focus should land in the chat composer, not a sidebar control. */
  useEffect(() => {
    setFocusComposerNonce((n) => n + 1);
  }, []);

  /**
   * Refocus the chat composer when the app window regains focus, unless the
   * user was last typing in some other field (note editor, settings, a modal).
   */
  useEffect(() => {
    if (view !== "chat") return;
    const onWindowFocus = () => {
      const active = document.activeElement as HTMLElement | null;
      const editingElsewhere =
        active != null &&
        active !== document.body &&
        !active.classList.contains("chat-input") &&
        (active.isContentEditable || active.matches("input, textarea, select"));
      if (!editingElsewhere) setFocusComposerNonce((n) => n + 1);
    };
    window.addEventListener("focus", onWindowFocus);
    return () => window.removeEventListener("focus", onWindowFocus);
  }, [view]);

  const resolveConversationTitle = useCallback(
    (id: string) => {
      const convo = chats.conversations.find((c) => c.id === id);
      return convo ? conversationDisplayTitle(convo.title, convo.createdAt) : null;
    },
    [chats.conversations],
  );

  const openConversation = useCallback(
    (id: string) => {
      setConversationId(id);
      setView("chat");
    },
    [setConversationId],
  );

  /**
   * Continue the most recent chat linked to the note (or start one) with the
   * note linked in the composer, optionally quoting a selection.
   */
  const discussNote = useCallback(
    (note: { id: string; title: string }, quote?: string) => {
      const summary = notesRef.current.find((n) => n.id === note.id);
      const linked = [...(summary?.conversationIds ?? [])]
        .reverse()
        .find((id) => chats.conversations.some((c) => c.id === id));
      setConversationId(linked ?? null);
      setView("chat");
      const label = note.title.replace(/[[\]]/g, "") || "Note";
      const quoted = quote?.trim()
        ? `${quote
            .trim()
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}\n\n`
        : "";
      setComposerDraft({ text: `${quoted}[${label}](/n/${note.id}) `, nonce: Date.now() });
    },
    [chats.conversations, notesRef, setConversationId],
  );

  const createNew = useCallback(() => {
    setConversationId(null);
    setView("chat");
    setFocusComposerNonce((n) => n + 1);
  }, [setConversationId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "k" && !e.shiftKey) {
        e.preventDefault();
        setSearchOpen((open) => !open);
        return;
      }
      if (key === "n") {
        e.preventDefault();
        if (e.shiftKey) {
          void createNewNote();
          return;
        }
        createNew();
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

  useEffect(() => {
    wireGlobalHotkeyActions({
      setGlobalHotkeyOverlaySession: hotkey.setOverlaySession,
      setGlobalHotkeyOverlayPhase: hotkey.setPhase,
      setGlobalHotkeyError: hotkey.setError,
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
      getOverlaySession: hotkey.getOverlaySession,
    });
    return () => wireGlobalHotkeyActions(null);
  }, [
    hotkey.setOverlaySession,
    hotkey.setPhase,
    hotkey.setError,
    hotkey.getOverlaySession,
    setConversationId,
    setConversations,
    refreshConversations,
    conversationIdRef,
    markTitleAwaiting,
    activeNoteIdRef,
    setActiveNoteId,
  ]);

  const handlePendingNoteHotkeyTextConsumed = useCallback(() => {
    setPendingNoteHotkeyText(null);
  }, []);

  const handleDevViewSelect = useCallback((devView: DevView) => {
    setView(devView);
  }, []);

  const chatTitlePending =
    view === "chat" &&
    activeChatConversation != null &&
    isConversationTitlePending(
      activeChatConversation.title,
      titles.isTitleGenerating(activeChatConversation.id),
    );

  const openChatTitleModal = useCallback(() => {
    setOpenTitleModalNonce((n) => n + 1);
  }, []);

  const activeChatDisplayTitle = activeChatConversation
    ? conversationDisplayTitle(activeChatConversation.title, activeChatConversation.createdAt)
    : null;

  const pageTitle = useMemo(() => {
    switch (view) {
      case "chat":
        return activeChatDisplayTitle ?? "New Chat";
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
      case "settings":
        return SETTINGS_PAGE_TITLE;
    }
  }, [view, activeChatDisplayTitle, notes, activeNoteId]);

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
        sidebarActions={
          <SidebarTitlebarActions
            view={view}
            onViewChange={handleViewChange}
            onNewChat={createNew}
            onNewNote={() => {
              void createNewNote();
            }}
            onNewImage={createNewImage}
          />
        }
        trailingActions={
          <TitlebarSettingsButton
            view={view}
            onViewChange={handleViewChange}
          />
        }
      />
      <div className="app-frame">
        <Sidebar
          conversations={chats.sidebarConversations}
          notes={notes}
          images={images}
          conversationId={conversationId}
          activeNoteId={activeNoteId}
          activeImageId={activeImageId}
          view={view}
          onViewChange={handleViewChange}
          onConversationSelect={handleConversationSelect}
          onConversationDelete={chats.deleteConversation}
          onSelectNote={handleSelectNoteFromLibrary}
          onNoteDelete={notesLib.deleteNote}
          onSelectImage={handleSelectImageFromLibrary}
          onImageDelete={imagesLib.deleteImage}
          activeChatProcessing={activeChatProcessing}
          processingImageIds={imagesLib.processingImageIds}
          titleGenInFlight={titles.titleGenInFlight}
          titleAwaitingIds={titles.titleAwaitingIds}
          appVersion={appVersion}
          updateStatus={updateStatus}
          onUpdateClick={startUpdate}
          showDevSection={false}
          onDevViewSelect={handleDevViewSelect}
          arrivedLibraryIds={arrivals.arrivedLibraryIds}
        />
        <main className="main">
          {(view === "chat" || activeChatProcessing) && (
            <div className="main-chat-host" hidden={view !== "chat"}>
              <ChatLayoutDebugHost active={view === "chat"}>
                <ChatView
                  conversationId={conversationId}
                  displayTitle={activeChatDisplayTitle ?? ""}
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
                  onAssignConversationId={chats.assignConversationId}
                  pendingHotkeyText={pendingHotkeyText}
                  pendingHotkeyDraftOnly={pendingHotkeyDraftOnly}
                  onPendingHotkeyTextConsumed={() => {
                    setPendingHotkeyText(null);
                    setPendingHotkeyDraftOnly(false);
                  }}
                  onChatActivityChange={setActiveChatProcessing}
                  focusComposerNonce={focusComposerNonce}
                  onOpenNotesView={(noteId) =>
                    openNoteInMain(noteId, { fromConversationId: conversationId })
                  }
                  onOpenConversation={openConversation}
                  composerDraft={composerDraft}
                  onComposerDraftConsumed={() => setComposerDraft(null)}
                  onOpenImage={(imageId) => openImageInMain(imageId)}
                  onNotesChanged={() => {
                    void loadNotesList();
                  }}
                  openAIConfigured={setup.chatModelAvailable}
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
              openAIConfigured={setup.openAIConfigured}
              onSettingsChanged={() => {
                void refreshSetupState();
              }}
              onImportComplete={loadConversations}
              onSyncComplete={refreshLibraryAfterSync}
            />
          )}
          {view === "tasks" && <TasksView />}
          {view === "notes" && (
            <NotesView
              notes={notes}
              onNotesChange={setNotes}
              initialOpenNoteId={notesLib.pendingOpenNoteRequest?.id ?? null}
              initialOpenNoteRequestNonce={notesLib.pendingOpenNoteRequest?.nonce}
              initialOpenNoteIsNew={notesLib.pendingOpenNoteRequest?.isNew}
              onInitialOpenNoteHandled={notesLib.clearPendingOpenNote}
              onActiveNoteChange={setActiveNoteId}
              pendingHotkeyText={pendingNoteHotkeyText}
              onPendingHotkeyTextConsumed={handlePendingNoteHotkeyTextConsumed}
              mirrorGlobalFnRecording={view === "notes"}
              returnToConversationId={
                noteReturnTo && noteReturnTo.noteId === activeNoteId
                  ? noteReturnTo.conversationId
                  : null
              }
              resolveConversationTitle={resolveConversationTitle}
              onOpenConversation={openConversation}
              onDiscussNote={discussNote}
            />
          )}
          {(view === "images" || imagesLib.activeImageProcessing || activeImageId != null) && (
            <div className="main-image-host" hidden={view !== "images"}>
              <ImageCanvasView
                imageId={activeImageId}
                onImageUpdated={imagesLib.handleImageUpdated}
                onImageRemoved={imagesLib.handleImageRemoved}
                onImageActivityChange={imagesLib.handleImageActivityChange}
              />
            </div>
          )}
          {view === "dev-chat" && <DevChatView />}
          {view === "dev-dictation" && <DevDictationView />}
          {view === "dev-note" && <DevPlaceholderView kind="note" />}
          {view === "dev-image" && <DevPlaceholderView kind="image" />}
        </main>
      </div>
      <SearchPalette
        open={searchOpen}
        onClose={closeSearch}
        conversations={chats.conversations}
        notes={notes}
        images={images}
        onSelectConversation={handleConversationSelect}
        onSelectNote={handleSelectNoteFromLibrary}
        onSelectImage={handleSelectImageFromLibrary}
      />
      <SetupNoticeModal
        open={setup.setupNoticeVisible}
        onSaveApiKey={setup.saveSetupApiKey}
        onDismiss={setup.dismissSetupNotice}
      />
      <HotkeyRecordingOverlay
        phase={hotkey.phase}
        error={hotkey.error}
        recordingPath={hotkey.recordingPath}
        needsAccessibility={hotkey.needsAccessibility}
        onRetry={hotkey.retry}
        onOpenAccessibilitySettings={hotkey.openAccessibilitySettings}
        onShowInFinder={hotkey.showInFinder}
        onDismiss={hotkey.dismiss}
      />
      {hotkey.error && hotkey.phase === "idle" ? (
        <div
          className="hotkey-recording-overlay__error"
          data-testid="hotkey-recording-error"
          data-retryable={hotkey.recordingPath ? "true" : "false"}
          role="status"
        >
          {hotkey.error}
          {hotkey.recordingPath ? (
            <div className="hotkey-recording-overlay__error-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid="hotkey-recording-error-retry"
                onClick={hotkey.retry}
              >
                Retry
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="hotkey-recording-error-dismiss"
                onClick={hotkey.dismiss}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
