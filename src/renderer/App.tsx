import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChatView } from "./ChatView";
import { SettingsView } from "./SettingsView";
import { TasksView } from "./TasksView";
import { NotesView } from "./WritingSurfaceView";
import { Sidebar } from "./Sidebar";
import { useRecorder } from "./useRecorder";
import { playCancelChime } from "./recordingUtils";
import type { LayoutOptions, Plan } from "../shared/types";
import type {} from "../shared/electronAPI";
import { conversationDisplayTitle } from "./chatDisplayTitle";
import type { Conversation, View } from "./sidebarUtils";
import { useViewportLayout } from "./useViewportLayout";

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [layout, setLayout] = useState<LayoutOptions>({ sidebar: "left", density: "comfortable" });
  const { presetSmall } = useViewportLayout();
  /** Incremented when entering small window on chat so ChatView focuses the composer. */
  const [focusComposerNonce, setFocusComposerNonce] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  /** True while the open chat is waiting on / streaming from the chat model (not composer voice). */
  const [activeChatProcessing, setActiveChatProcessing] = useState(false);
  /** Per-conversation refcount for async LLM thread title generation after a reply. */
  const [titleGenInFlight, setTitleGenInFlight] = useState<Record<string, number>>({});
  /** Note id to open when entering Notes from chat message action. */
  const [pendingOpenNoteId, setPendingOpenNoteId] = useState<string | null>(null);
  const [notesScreen, setNotesScreen] = useState<"list" | "detail">("list");
  const [notesOverviewNonce, setNotesOverviewNonce] = useState(0);

  // Hotkey recorder — owns the background mic capture for the global shortcut path
  const hotkeyRecorder = useRecorder();

  // Text from the hotkey — injected into the open chat (send vs pre-fill follows recording.autoSend unless draft-only)
  const [pendingHotkeyText, setPendingHotkeyText] = useState<string | null>(null);
  /** When true, hotkey text is always pre-filled (never auto-sent). Used for global recording while the app was unfocused. */
  const [pendingHotkeyDraftOnly, setPendingHotkeyDraftOnly] = useState(false);

  const hotkeyRecordingRef = useRef(false);
  const hotkeyCancelledRef = useRef(false);

  const conversationIdRef = useRef(conversationId);
  useEffect(() => { conversationIdRef.current = conversationId; }, [conversationId]);

  const loadPlans = useCallback(async () => {
    const list = await window.electron.plans.list();
    setPlans(list);
  }, []);

  const loadConversations = useCallback(async () => {
    const list = await window.electron.memory.listConversations();
    setConversations(list);
    setConversationId((current) => {
      if (list.length === 0) return null;
      if (!current) return list[0].id;
      if (list.some((c) => c.id === current)) return current;
      return list[0].id;
    });
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const unsub = window.electron.chat.onConversationTitleUpdated(() => {
      void loadConversations();
    });
    return unsub;
  }, [loadConversations]);

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
    const unsubStart = window.electron.chat.onTitleGenerationStarted((id) => bumpTitleGen(id, 1));
    const unsubEnd = window.electron.chat.onTitleGenerationEnded((id) => bumpTitleGen(id, -1));
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
    window.electron.app.getVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  useEffect(() => {
    const ensureCustomThemeLast = () => {
      const el = document.getElementById("custom-theme");
      if (el) document.head.appendChild(el);
    };
    const themeRequestSeqRef = { current: 0 };
    const refreshThemeCss = () => {
      const seq = ++themeRequestSeqRef.current;
      window.electron.customization.getActiveTheme().then((css) => {
        if (seq !== themeRequestSeqRef.current) return;
        ensureCustomThemeLast();
        const el = document.getElementById("custom-theme") as HTMLStyleElement | null;
        if (el) el.textContent = css;
      });
    };
    ensureCustomThemeLast();
    window.electron.customization.getLayoutOptions().then(setLayout);
    refreshThemeCss();
    const unsub = window.electron.customization.onUpdated((p) => {
      if (p.type === "theme") {
        refreshThemeCss();
      }
      if (p.type === "layout") {
        window.electron.customization.getLayoutOptions().then(setLayout);
      }
    });
    return unsub;
  }, []);

  const createNew = useCallback(async () => {
    const id = await window.electron.memory.createConversation();
    setConversationId(id);
    setConversations((prev) => [{ id, title: null, createdAt: Date.now() }, ...prev]);
    setView("chat");
    setFocusComposerNonce((n) => n + 1);
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
    await window.electron.windowSize.toggle();
  }, []);

  const handleConversationDelete = useCallback(async (id: string) => {
    await window.electron.memory.deleteConversation(id);
    const remaining = conversations.filter((c) => c.id !== id);
    setConversations(remaining);
    if (conversationId === id) {
      setConversationId(remaining[0]?.id ?? null);
    }
  }, [conversationId, conversations]);

  const handleNotesClick = useCallback(() => {
    setPendingOpenNoteId(null);
    setNotesOverviewNonce((n) => n + 1);
    setView("notes");
  }, []);

  useEffect(() => {
    const unsub = window.electron.recording.onStartSilent(async () => {
      hotkeyCancelledRef.current = false;
      hotkeyRecordingRef.current = true;
      if (await window.electron.env.isHarnessE2E()) {
        return;
      }
      try {
        await hotkeyRecorder.start();
      } catch (_) {
        hotkeyRecordingRef.current = false;
      }
    });
    return unsub;
  // hotkeyRecorder is stable (created once via useRef internals)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = window.electron.recording.onStopAndPaste(async (wasFocused: boolean) => {
      hotkeyRecordingRef.current = false;
      try {
        const wav = (await window.electron.env.isHarnessE2E())
          ? new ArrayBuffer(0)
          : await hotkeyRecorder.stop();
        if (hotkeyCancelledRef.current) return;
        window.electron.recording.saveWav(wav).catch(() => {});
        const result = await window.electron.recording.transcribe(wav);
        if (hotkeyCancelledRef.current) return;
        if (!("error" in result)) {
          const text = result.text.trim();
          if (!text) return;
          if (wasFocused) {
            let targetId = conversationIdRef.current;
            if (!targetId) {
              targetId = await window.electron.memory.createConversation();
              setConversations((prev) => [{ id: targetId!, title: null, createdAt: Date.now() }, ...prev]);
              setConversationId(targetId);
              setFocusComposerNonce((n) => n + 1);
            }
            setView("chat");
            setPendingHotkeyDraftOnly(false);
            setPendingHotkeyText(text);
          } else {
            await window.electron.recording.pasteText(text);
            const newId = await window.electron.memory.createConversation();
            await window.electron.memory.appendMessage(newId, "user", text, { timestamp: Date.now() });
            const voiceTitle = await window.electron.memory.setVoiceDictationTitle(newId);
            setConversations((prev) => [{ id: newId, title: voiceTitle, createdAt: Date.now() }, ...prev]);
            setConversationId(newId);
            setView("chat");
            setFocusComposerNonce((n) => n + 1);
            void loadConversations();
          }
        }
      } finally {
        if (!hotkeyCancelledRef.current) {
          await window.electron.recording.done();
        }
      }
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = window.electron.recording.onCancel(async () => {
      hotkeyCancelledRef.current = true;
      if (hotkeyRecordingRef.current) {
        hotkeyRecordingRef.current = false;
        try { await hotkeyRecorder.stop(); } catch (_) { /* already stopped */ }
      }
      playCancelChime();
      await window.electron.recording.done();
    });
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <div className="app" data-sidebar={layout.sidebar}>
      <Sidebar
        conversations={conversations}
        conversationId={conversationId}
        view={view}
        onViewChange={setView}
        onConversationSelect={setConversationId}
        onConversationDelete={handleConversationDelete}
        onNewChat={createNew}
        windowPresetSmall={presetSmall}
        onWindowSizeToggle={handleWindowSizeToggle}
        activeChatProcessing={activeChatProcessing}
        titleGenInFlight={titleGenInFlight}
        appVersion={appVersion}
        notesItemActive={view === "notes" && notesScreen === "list"}
        onNotesClick={handleNotesClick}
      />
      <main className="main">
        {view === "chat" && (
          <ChatView
            key={conversationId ?? "none"}
            conversationId={conversationId}
            displayTitle={
              activeChatConversation
                ? conversationDisplayTitle(activeChatConversation.title, activeChatConversation.createdAt)
                : ""
            }
            onConversationCreated={loadConversations}
            pendingHotkeyText={pendingHotkeyText}
            pendingHotkeyDraftOnly={pendingHotkeyDraftOnly}
            onPendingHotkeyTextConsumed={() => {
              setPendingHotkeyText(null);
              setPendingHotkeyDraftOnly(false);
            }}
            onChatActivityChange={handleChatActivityChange}
            focusComposerNonce={focusComposerNonce}
            onOpenNotesView={(noteId) => {
              setPendingOpenNoteId(noteId);
              setView("notes");
            }}
          />
        )}
        {view === "settings" && (
          <SettingsView onImportComplete={loadConversations} />
        )}
        {view === "tasks" && <TasksView />}
        {view === "notes" && (
          <NotesView
            initialOpenNoteId={pendingOpenNoteId}
            onInitialOpenNoteHandled={() => setPendingOpenNoteId(null)}
            resetToOverviewNonce={notesOverviewNonce}
            onScreenChange={setNotesScreen}
          />
        )}
      </main>
    </div>
  );
}
