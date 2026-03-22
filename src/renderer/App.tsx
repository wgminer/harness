import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Settings, Maximize2, Minimize2, Plus, Search, X, ListTodo, ChevronRight, ChevronDown, FolderPlus } from "lucide-react";
import { ChatView } from "./ChatView";
import { SettingsView } from "./SettingsView";
import { TasksView } from "./TasksView";
import { useRecorder } from "./useRecorder";
import { playCancelChime } from "./recordingUtils";
import type { LayoutOptions, Plan, SearchResult } from "../shared/types";
import type {} from "../shared/electronAPI";

type Conversation = { id: string; title: string | null; createdAt: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Returns a sortable key:
 * - today | yesterday
 * - YYYY-MM-DD for each of the 7 calendar days 2–8 days ago (labeled by weekday in the UI)
 * - earlier-in:YYYY-MM for the rest of the current calendar month
 * - month:YYYY-MM for prior full months
 */
function getDateGroupKey(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - MS_PER_DAY;
  const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  if (dateStart >= todayStart) return "today";
  if (dateStart >= yesterdayStart) return "yesterday";
  const daysAgo = Math.floor((todayStart - dateStart) / MS_PER_DAY);
  if (daysAgo >= 2 && daysAgo <= 8) {
    return localDateKey(date);
  }
  const sameMonth =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (sameMonth && daysAgo >= 9) {
    return `earlier-in:${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `month:${y}-${m}`;
}

/** Display label for a group key. */
function getDateGroupLabel(key: string): string {
  if (key === "today") return "Today";
  if (key === "yesterday") return "Yesterday";
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = new Date(key + "T12:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  if (key.startsWith("earlier-in:")) {
    const ym = key.slice("earlier-in:".length);
    const [yStr, mStr] = ym.split("-");
    const d = new Date(parseInt(yStr, 10), parseInt(mStr, 10) - 1, 1);
    const monthName = d.toLocaleDateString(undefined, { month: "long" });
    return `Earlier in ${monthName}`;
  }
  if (key.startsWith("month:")) {
    const ym = key.slice("month:".length);
    const [yStr, mStr] = ym.split("-");
    const y = parseInt(yStr, 10);
    const d = new Date(y, parseInt(mStr, 10) - 1, 1);
    const now = new Date();
    return d.toLocaleDateString(undefined, {
      month: "long",
      year: y !== now.getFullYear() ? "numeric" : undefined,
    });
  }
  return key;
}

type SidebarGroup = { key: string; label: string; items: Conversation[] };

function groupConversations(conversations: Conversation[]): { groups: SidebarGroup[] } {
  const byKey = new Map<string, Conversation[]>();
  for (const c of conversations) {
    const key = getDateGroupKey(c.createdAt);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(c);
  }
  for (const items of byKey.values()) {
    items.sort((a, b) => b.createdAt - a.createdAt);
  }

  const now = new Date();
  const keyOrder: string[] = ["today", "yesterday"];
  for (let d = 2; d <= 8; d++) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    t.setDate(t.getDate() - d);
    keyOrder.push(localDateKey(t));
  }
  const cy = now.getFullYear();
  const cm = String(now.getMonth() + 1).padStart(2, "0");
  keyOrder.push(`earlier-in:${cy}-${cm}`);

  const monthKeys = Array.from(byKey.keys())
    .filter((k) => k.startsWith("month:"))
    .sort((a, b) => b.localeCompare(a));
  keyOrder.push(...monthKeys);

  const groups: SidebarGroup[] = [];
  for (const key of keyOrder) {
    const items = byKey.get(key);
    if (items?.length) {
      groups.push({ key, label: getDateGroupLabel(key), items });
    }
  }

  return { groups };
}

function formatNewChatLabel(createdAt: number): string {
  return "New Chat " + new Date(createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function HighlightText({ text, range }: { text: string; range?: [number, number] }) {
  if (range == null || range[0] < 0 || range[1] <= range[0] || range[0] >= text.length) {
    return <>{text}</>;
  }
  const start = Math.max(0, range[0]);
  const end = Math.min(text.length, range[1]);
  return (
    <>
      {text.slice(0, start)}
      <mark className="search-highlight">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

type View = "chat" | "settings" | "tasks";

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [layout, setLayout] = useState<LayoutOptions>({ sidebar: "left", density: "comfortable" });
  const [windowSize, setWindowSize] = useState<"small" | "large">("large");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [expandedPlanId, setExpandedPlanId] = useState<string | null>(null);
  const [addToPlanOpen, setAddToPlanOpen] = useState(false);
  const addToPlanRef = useRef<HTMLDivElement>(null);
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [newPlanTitle, setNewPlanTitle] = useState("");
  const [newPlanDescription, setNewPlanDescription] = useState("");
  const [appVersion, setAppVersion] = useState<string | null>(null);
  /** Bump to remount TasksView after tasks.json is cleared externally (e.g. settings reset). */
  const [tasksRemountKey, setTasksRemountKey] = useState(0);

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

  const onStoredDataReset = useCallback(() => {
    void loadConversations();
    void loadPlans();
    setExpandedPlanId(null);
    setTasksRemountKey((k) => k + 1);
  }, [loadConversations, loadPlans]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const unsub = window.electron.chat.onConversationTitleUpdated(() => {
      void loadConversations();
    });
    return unsub;
  }, [loadConversations]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    window.electron.windowSize.get().then(setWindowSize);
  }, []);

  useEffect(() => {
    window.electron.app.getVersion().then(setAppVersion).catch(() => setAppVersion(null));
  }, []);

  useEffect(() => {
    window.electron.customization.getLayoutOptions().then(setLayout);
    window.electron.customization.getActiveTheme().then((css) => {
      const el = document.getElementById("custom-theme") as HTMLStyleElement | null;
      if (el) el.textContent = css;
    });
    const unsub = window.electron.customization.onUpdated((p) => {
      if (p.type === "theme") {
        window.electron.customization.getActiveTheme().then((css) => {
          const el = document.getElementById("custom-theme") as HTMLStyleElement | null;
          if (el) el.textContent = css;
        });
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
  }, []);


  useEffect(() => {
    const unsub = window.electron.recording.onStartSilent(async () => {
      hotkeyCancelledRef.current = false;
      hotkeyRecordingRef.current = true;
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
        const wav = await hotkeyRecorder.stop();
        if (hotkeyCancelledRef.current) return;
        window.electron.recording.saveWav(wav).catch(() => {});
        const result = await window.electron.recording.transcribe(wav);
        if (hotkeyCancelledRef.current) return;
        if (!("error" in result)) {
          if (wasFocused) {
            let targetId = conversationIdRef.current;
            if (!targetId) {
              targetId = await window.electron.memory.createConversation();
              setConversations((prev) => [{ id: targetId!, title: null, createdAt: Date.now() }, ...prev]);
              setConversationId(targetId);
            }
            setView("chat");
            setPendingHotkeyDraftOnly(false);
            setPendingHotkeyText(result.text);
          } else {
            await window.electron.recording.pasteText(result.text);
            const newId = await window.electron.memory.createConversation();
            await window.electron.memory.appendMessage(newId, "user", result.text);
            const voiceTitle = await window.electron.memory.setVoiceDictationTitle(newId);
            setConversations((prev) => [{ id: newId, title: voiceTitle, createdAt: Date.now() }, ...prev]);
            setConversationId(newId);
            setView("chat");
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

  const deleteConversation = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      await window.electron.memory.deleteConversation(id);
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);
      if (conversationId === id) {
        setConversationId(remaining[0]?.id ?? null);
      }
    },
    [conversationId, conversations]
  );

  const { groups: sidebarGroups } = useMemo(() => groupConversations(conversations), [conversations]);

  useEffect(() => {
    if (!searchOpen) return;
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(() => {
      window.electron.memory.searchConversations(trimmed).then((results) => {
        setSearchResults(results);
        setSearchLoading(false);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [searchOpen, searchQuery]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    } else {
      searchButtonRef.current?.focus();
    }
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  const handleSearchResultClick = useCallback(
    (id: string) => {
      setConversationId(id);
      setView("chat");
      closeSearch();
    },
    [closeSearch]
  );

  const handleCreatePlan = useCallback(async () => {
    const title = newPlanTitle.trim() || "Untitled plan";
    const plan = await window.electron.plans.create(title, newPlanDescription.trim());
    setPlans((prev) => [plan, ...prev]);
    setNewPlanTitle("");
    setNewPlanDescription("");
    setNewPlanOpen(false);
    if (conversationId) {
      await window.electron.plans.addConversation(plan.id, conversationId);
      setPlans((prev) => prev.map((p) => (p.id === plan.id ? { ...p, conversationIds: [...p.conversationIds, conversationId] } : p)));
    }
  }, [newPlanTitle, newPlanDescription, conversationId]);

  const handleAddToPlan = useCallback(
    async (planId: string) => {
      if (!conversationId) return;
      await window.electron.plans.addConversation(planId, conversationId);
      setPlans((prev) =>
        prev.map((p) => (p.id === planId ? { ...p, conversationIds: [...p.conversationIds, conversationId] } : p))
      );
      setAddToPlanOpen(false);
    },
    [conversationId]
  );

  const handleRemoveFromPlan = useCallback(async (planId: string, convId: string) => {
    await window.electron.plans.removeConversation(planId, convId);
    setPlans((prev) =>
      prev.map((p) => (p.id === planId ? { ...p, conversationIds: p.conversationIds.filter((id) => id !== convId) } : p))
    );
  }, []);

  const handleDeletePlan = useCallback(async (e: React.MouseEvent, planId: string) => {
    e.stopPropagation();
    await window.electron.plans.delete(planId);
    setPlans((prev) => prev.filter((p) => p.id !== planId));
    if (expandedPlanId === planId) setExpandedPlanId(null);
  }, [expandedPlanId]);

  const convById = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);

  return (
    <div
      className="app"
      data-sidebar={layout.sidebar}
      data-density={layout.density}
      data-window-size={windowSize}
    >
      <aside className="sidebar">
        {searchOpen ? (
          <div className="sidebar-search-row">
            <input
              ref={searchInputRef}
              type="search"
              className="sidebar-search-input"
              placeholder="Search conversations…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
              }}
              aria-label="Search conversations"
            />
            <button
              type="button"
              className="btn btn-icon"
              onClick={closeSearch}
              aria-label="Close search"
            >
              <X size={18} />
            </button>
          </div>
        ) : (
          <div className="sidebar-buttons">
            <button type="button" className="btn mr-auto" onClick={createNew}>
              <Plus size={18} style={{ marginRight: 6 }} />
              New
            </button>
            <button
              ref={searchButtonRef}
              type="button"
              className="btn btn-icon"
              onClick={() => setSearchOpen(true)}
              aria-label="Search conversations"
            >
              <Search size={18} />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setView("tasks")}
              aria-label="Tasks"
            >
              <ListTodo size={18} />
            </button>
            <button type="button" className="btn btn-icon" onClick={() => setView("settings")} aria-label="Settings">
              <Settings size={18} />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={async () => { const next = await window.electron.windowSize.toggle(); setWindowSize(next); }}
              aria-label={windowSize === "large" ? "Shrink window" : "Expand window"}
            >
              {windowSize === "large" ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>
          </div>
        )}
        <ul className="sidebar-list">
          {searchOpen ? (
            searchQuery.trim() ? (
              searchLoading ? (
                <li className="sidebar-search-empty">Searching…</li>
              ) : searchResults.length === 0 ? (
                <li className="sidebar-search-empty">No results</li>
              ) : (
                searchResults.map((r) => (
                  <li
                    key={r.id}
                    className={`search-result-item ${conversationId === r.id ? "active" : ""}`}
                    onClick={() => handleSearchResultClick(r.id)}
                  >
                    <span className="search-result-title">
                      <HighlightText
                        text={r.title || formatNewChatLabel(r.createdAt)}
                        range={r.titleMatched ? r.titleMatchRange ?? undefined : undefined}
                      />
                    </span>
                    <span className="search-result-snippet">
                      <HighlightText
                        text={r.snippet}
                        range={
                          r.snippetMatchRange[0] >= 0 && r.snippetMatchRange[1] > r.snippetMatchRange[0]
                            ? r.snippetMatchRange
                            : undefined
                        }
                      />
                    </span>
                  </li>
                ))
              )
            ) : (
              <li className="sidebar-search-empty">Type to search</li>
            )
          ) : (
            <>
              {sidebarGroups.map(({ key, label, items }) => (
                <li key={key} className="sidebar-group">
                  <span className="sidebar-group-label">{label}</span>
                  <ul className="sidebar-group-items">
                    {items.map((c) => (
                      <li
                        key={c.id}
                        className={`sidebar-item ${conversationId === c.id ? "active" : ""}`}
                        onClick={() => { setConversationId(c.id); setView("chat"); }}
                      >
                        <span className="sidebar-item-title">{c.title || formatNewChatLabel(c.createdAt)}</span>
                        <button
                          type="button"
                          className="sidebar-item-delete"
                          onClick={(e) => deleteConversation(e, c.id)}
                          aria-label="Delete conversation"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </>
          )}
        </ul>
        {appVersion != null && appVersion !== "" ? (
          <div className="sidebar-version" title={`Harness ${appVersion}`}>
            v{appVersion}
          </div>
        ) : null}
      </aside>
      <main className="main">
        {view === "chat" && (
          <ChatView
            key={conversationId ?? "none"}
            conversationId={conversationId}
            onConversationCreated={loadConversations}
            pendingHotkeyText={pendingHotkeyText}
            pendingHotkeyDraftOnly={pendingHotkeyDraftOnly}
            onPendingHotkeyTextConsumed={() => {
              setPendingHotkeyText(null);
              setPendingHotkeyDraftOnly(false);
            }}
          />
        )}
        {view === "settings" && (
          <SettingsView
            onBack={() => setView("chat")}
            onImportComplete={loadConversations}
            onStoredDataReset={onStoredDataReset}
          />
        )}
        {view === "tasks" && <TasksView key={tasksRemountKey} onBack={() => setView("chat")} />}
      </main>
    </div>
  );
}
