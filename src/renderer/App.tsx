import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Settings, Maximize2, Minimize2, Plus, Search, X, ListTodo, ChevronRight, ChevronDown, History, Home } from "lucide-react";
import { ChatView } from "./ChatView";
import { SettingsView } from "./SettingsView";
import { TasksView } from "./TasksView";
import type { LayoutOptions, Plan, SearchResult } from "../shared/types";

type Conversation = { id: string; title: string | null; createdAt: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Returns a sortable key: "today" | "yesterday" | YYYY-MM-DD (past 7 days) | YYYY-MM (month). */
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
    return date.toISOString().slice(0, 10); // YYYY-MM-DD for weekday grouping
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Display label for a group key. */
function getDateGroupLabel(key: string): string {
  if (key === "today") return "Today";
  if (key === "yesterday") return "Yesterday";
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const d = new Date(key + "T12:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  if (/^\d{4}-\d{2}$/.test(key)) {
    const [y, m] = key.split("-");
    const d = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
    const now = new Date();
    return d.toLocaleDateString(undefined, {
      month: "long",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  }
  return key;
}

type SidebarGroup = { key: string; label: string; items: Conversation[] };

const RECENT_MONTHS_COUNT = 3;

function groupConversations(conversations: Conversation[]): {
  recentGroups: SidebarGroup[];
  olderMonthKeys: string[];
  olderByMonth: Map<string, Conversation[]>;
} {
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
  const monthKeys = Array.from(byKey.keys()).filter((k) => /^\d{4}-\d{2}$/.test(k));
  monthKeys.sort((a, b) => b.localeCompare(a));
  const recentMonthKeys = monthKeys.slice(0, RECENT_MONTHS_COUNT);
  const olderMonthKeys = monthKeys.slice(RECENT_MONTHS_COUNT);

  const recentKeysOrder: string[] = ["today", "yesterday"];
  for (let d = 2; d <= 8; d++) {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    t.setDate(t.getDate() - d);
    recentKeysOrder.push(t.toISOString().slice(0, 10));
  }
  recentKeysOrder.push(...recentMonthKeys);

  const recentGroups: SidebarGroup[] = [];
  for (const key of recentKeysOrder) {
    const items = byKey.get(key);
    if (items?.length) {
      recentGroups.push({ key, label: getDateGroupLabel(key), items });
    }
  }

  const olderByMonth = new Map<string, Conversation[]>();
  for (const key of olderMonthKeys) {
    const items = byKey.get(key);
    if (items?.length) olderByMonth.set(key, items);
  }

  return { recentGroups, olderMonthKeys, olderByMonth };
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

declare global {
  interface Window {
    electron: {
      windowSize: { get: () => Promise<"small" | "large">; toggle: () => Promise<"small" | "large"> };
      settings: { get: () => Promise<unknown>; set: (p: unknown) => Promise<unknown> };
      memory: {
        createConversation: () => Promise<string>;
        getConversation: (id: string) => Promise<unknown>;
        listConversations: () => Promise<{ id: string; title: string | null; createdAt: number }[]>;
        deleteConversation: (id: string) => Promise<void>;
        getMessages: (id: string) => Promise<{ role: string; content: string }[]>;
        getUserMemory: () => Promise<Record<string, string>>;
        setUserMemory: (key: string, value: string) => Promise<void>;
        searchConversations: (query: string) => Promise<SearchResult[]>;
        importFromChatGPTFolder: () => Promise<{ imported: number; errors: string[] }>;
        resetHistory: () => Promise<void>;
      };
      plans: {
        list: () => Promise<Plan[]>;
        create: (title: string, description: string) => Promise<Plan>;
        update: (planId: string, updates: { title?: string; description?: string }) => Promise<Plan | null>;
        delete: (planId: string) => Promise<void>;
        addConversation: (planId: string, conversationId: string) => Promise<Plan | null>;
        removeConversation: (planId: string, conversationId: string) => Promise<Plan | null>;
      };
      chat: {
        send: (conversationId: string, content: string) => Promise<void>;
        stop: () => Promise<void>;
        resolveGatedTool: (pendingId: string, action: "proceed" | "cancel") => Promise<void>;
        onStreamChunk: (cb: (conversationId: string, chunk: string) => void) => () => void;
        onStreamEnd: (cb: (conversationId: string) => void) => () => void;
        onToolPanelUpdate: (cb: (conversationId: string, toolName: string, payload: unknown) => void) => () => void;
      };
      customization: {
        getActiveTheme: () => Promise<string>;
        setTheme: (css: string) => Promise<void>;
        getLayoutOptions: () => Promise<LayoutOptions>;
        setLayout: (o: Partial<LayoutOptions>) => Promise<void>;
        onUpdated: (cb: (p: { type: string }) => void) => () => void;
      };
      tasks: {
        list: () => Promise<{ tasks: { id: string; title: string; status: string }[] }>;
        create: (title: string, status?: string) => Promise<{ tasks: { id: string; title: string; status: string }[] }>;
        update: (payload: { id: string; title?: string; status?: string }) => Promise<{ tasks: { id: string; title: string; status: string }[] }>;
        delete: (id: string) => Promise<{ tasks: { id: string; title: string; status: string }[] }>;
        clearCompleted: () => Promise<{ tasks: { id: string; title: string; status: string }[] }>;
      };
    };
  }
}

type View = "chat" | "settings" | "tasks";

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [layout, setLayout] = useState<LayoutOptions>({ sidebar: "left", density: "comfortable" });
  const [windowSize, setWindowSize] = useState<"small" | "large">("large");
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
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

  const loadPlans = useCallback(async () => {
    const list = await window.electron.plans.list();
    setPlans(list);
  }, []);

  const loadConversations = useCallback(async () => {
    const list = await window.electron.memory.listConversations();
    setConversations(list);
    if (list.length > 0 && !conversationId) setConversationId(list[0].id);
  }, [conversationId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    window.electron.windowSize.get().then(setWindowSize);
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

  const { recentGroups, olderMonthKeys, olderByMonth } = useMemo(
    () => groupConversations(conversations),
    [conversations]
  );
  const [olderSelectedMonth, setOlderSelectedMonth] = useState<string | null>(null);

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

  const openSearch = useCallback(() => {
    setHistoryOpen(false);
    setSearchOpen(true);
  }, []);

  const toggleHistory = useCallback(() => {
    setHistoryOpen((prev) => {
      const next = !prev;
      if (next) setSearchOpen(false);
      return next;
    });
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
      {newPlanOpen && (
        <div className="modal-overlay" onClick={() => setNewPlanOpen(false)}>
          <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">New plan</h2>
            <label className="modal-field">
              <span>Objective</span>
              <input
                type="text"
                className="modal-input"
                placeholder="Short goal or title"
                value={newPlanTitle}
                onChange={(e) => setNewPlanTitle(e.target.value)}
                autoFocus
              />
            </label>
            <label className="modal-field">
              <span>Description</span>
              <textarea
                className="modal-input modal-textarea"
                placeholder="Optional description"
                value={newPlanDescription}
                onChange={(e) => setNewPlanDescription(e.target.value)}
                rows={3}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setNewPlanOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => handleCreatePlan()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
      <aside className="sidebar">
        <header className="sidebar-header">
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
              <button type="button" className="btn btn-icon" onClick={createNew} aria-label="Home">
                <Home size={18} />
              </button>
              <button type="button" className="btn btn-icon" onClick={createNew} aria-label="New chat">
                <Plus size={18} />
              </button>
              <button
                ref={searchButtonRef}
                type="button"
                className="btn btn-icon"
                onClick={openSearch}
                aria-label="Search conversations"
              >
                <Search size={18} />
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
        </header>
        <div className="sidebar-body">
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
                          text={typeof r.title === "string" ? r.title : r.id}
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
                <li className="sidebar-nav-item-wrap">
                  <button
                    type="button"
                    className={`sidebar-item sidebar-nav-link ${view === "settings" ? "active" : ""}`}
                    onClick={() => setView("settings")}
                  >
                    <Settings size={16} style={{ flexShrink: 0 }} />
                    <span className="sidebar-item-title">Settings</span>
                  </button>
                </li>
                <li className="sidebar-nav-item-wrap">
                  <button
                    type="button"
                    className={`sidebar-item sidebar-nav-link ${historyOpen ? "active" : ""}`}
                    onClick={toggleHistory}
                    aria-expanded={historyOpen}
                  >
                    <History size={16} style={{ flexShrink: 0 }} />
                    <span className="sidebar-item-title">History</span>
                  </button>
                </li>
                {historyOpen && (
                  <>
                    {recentGroups.map(({ key, label, items }) => (
                      <li key={key} className="sidebar-group">
                        <span className="sidebar-group-label">{label}</span>
                        <ul className="sidebar-group-items">
                          {items.map((c) => (
                            <li
                              key={c.id}
                              className={`sidebar-item ${conversationId === c.id ? "active" : ""}`}
                              onClick={() => {
                                setConversationId(c.id);
                                setView("chat");
                                setHistoryOpen(false);
                              }}
                            >
                              <span className="sidebar-item-title">{typeof c.title === "string" ? c.title : c.id}</span>
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
                    {olderMonthKeys.length > 0 && (
                      <li className="sidebar-group sidebar-group-older">
                        <span className="sidebar-group-label">Older</span>
                        <div className="sidebar-older-picker">
                          <select
                            className="sidebar-older-select"
                            value={olderSelectedMonth ?? ""}
                            onChange={(e) => setOlderSelectedMonth(e.target.value || null)}
                            aria-label="Select month"
                          >
                            <option value="">Select month…</option>
                            {olderMonthKeys.map((monthKey) => (
                              <option key={monthKey} value={monthKey}>
                                {getDateGroupLabel(monthKey)}
                              </option>
                            ))}
                          </select>
                        </div>
                        {olderSelectedMonth && olderByMonth.has(olderSelectedMonth) && (
                          <ul className="sidebar-group-items">
                            {olderByMonth.get(olderSelectedMonth)!.map((c) => (
                              <li
                                key={c.id}
                                className={`sidebar-item ${conversationId === c.id ? "active" : ""}`}
                                onClick={() => {
                                  setConversationId(c.id);
                                  setView("chat");
                                  setHistoryOpen(false);
                                }}
                              >
                                <span className="sidebar-item-title">{typeof c.title === "string" ? c.title : c.id}</span>
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
                        )}
                      </li>
                    )}
                  </>
                )}
                <li className="sidebar-group">
                  <div className="sidebar-group-label-row">
                    <span className="sidebar-group-label">Plans</span>
                    <button
                      type="button"
                      className="btn btn-icon sidebar-group-action"
                      onClick={() => setNewPlanOpen(true)}
                      aria-label="New plan"
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                  <ul className="sidebar-group-items">
                    {plans.length === 0 ? (
                      <li className="sidebar-search-empty">No plans</li>
                    ) : (
                      plans.map((plan) => (
                        <li key={plan.id} className="sidebar-plan-item-wrap">
                          <div
                            role="button"
                            tabIndex={0}
                            className="sidebar-plan-item"
                            onClick={() => setExpandedPlanId((id) => (id === plan.id ? null : plan.id))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setExpandedPlanId((id) => (id === plan.id ? null : plan.id));
                              }
                            }}
                            aria-expanded={expandedPlanId === plan.id}
                            aria-label={`Plan: ${plan.title}`}
                          >
                            {plan.conversationIds.length > 0 ? (
                              expandedPlanId === plan.id ? (
                                <ChevronDown size={14} className="sidebar-plan-chevron" />
                              ) : (
                                <ChevronRight size={14} className="sidebar-plan-chevron" />
                              )
                            ) : (
                              <span className="sidebar-plan-chevron-placeholder" />
                            )}
                            <div className="sidebar-plan-content">
                              <span className="sidebar-item-title" title={plan.title}>
                                {plan.title || "Untitled plan"}
                              </span>
                              {plan.description ? (
                                <span className="sidebar-plan-description" title={plan.description}>
                                  {plan.description}
                                </span>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              className="sidebar-item-delete"
                              onClick={(e) => handleDeletePlan(e, plan.id)}
                              aria-label="Delete plan"
                            >
                              ×
                            </button>
                          </div>
                          {expandedPlanId === plan.id && plan.conversationIds.length > 0 && (
                            <ul className="sidebar-plan-conversations">
                              {plan.conversationIds.map((convId) => {
                                const c = convById.get(convId);
                                return (
                                  <li
                                    key={convId}
                                    className={`sidebar-item sidebar-plan-conv-item ${conversationId === convId ? "active" : ""}`}
                                    onClick={() => { setConversationId(convId); setView("chat"); }}
                                  >
                                    <span className="sidebar-item-title">
                                      {c ? (typeof c.title === "string" ? c.title : c.id) : convId}
                                    </span>
                                    <button
                                      type="button"
                                      className="sidebar-item-delete"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleRemoveFromPlan(plan.id, convId);
                                      }}
                                      aria-label="Remove from plan"
                                    >
                                      ×
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </li>
                      ))
                    )}
                  </ul>
                </li>
                <li className="sidebar-nav-item-wrap">
                  <button
                    type="button"
                    className={`sidebar-item sidebar-nav-link sidebar-tasks-entry ${view === "tasks" ? "active" : ""}`}
                    onClick={() => setView("tasks")}
                  >
                    <ListTodo size={16} style={{ flexShrink: 0 }} />
                    <span className="sidebar-item-title">Tasks</span>
                  </button>
                </li>
              </>
            )}
          </ul>
        </div>
      </aside>
      <main className="main">
        {view === "chat" && (
          <ChatView
            conversationId={conversationId}
            onConversationCreated={loadConversations}
          />
        )}
        {view === "settings" && <SettingsView onBack={() => setView("chat")} onImportComplete={loadConversations} />}
        {view === "tasks" && <TasksView onBack={() => setView("chat")} />}
      </main>
      <style id="custom-theme" />
    </div>
  );
}
