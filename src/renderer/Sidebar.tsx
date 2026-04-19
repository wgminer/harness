import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Settings, Maximize2, Minimize2, NotebookPen, Plus, Search, X, ListTodo, Loader2 } from "lucide-react";
import type { SearchResult } from "../shared/types";
import { formatNewChatLabel } from "./chatDisplayTitle";
import {
  type Conversation,
  type View,
  type SidebarGroup,
  SIDEBAR_PREVIEW_ROW_PX,
  SIDEBAR_PREVIEW_STORAGE_KEY,
  clampSidebarPreviewCount,
  loadSidebarPreviewCount,
  groupConversations,
  pickSidebarConversationsForList,
} from "./sidebarUtils";

interface SidebarProps {
  conversations: Conversation[];
  conversationId: string | null;
  view: View;
  onViewChange: (v: View) => void;
  onConversationSelect: (id: string) => void;
  onConversationDelete: (id: string) => void;
  onNewChat: () => void;
  /** Sidebar off-canvas / edge hit target (viewport-based). */
  compactLayout: boolean;
  /** Matches main-process small preset width for shrink/expand toggle icon. */
  windowPresetSmall: boolean;
  onWindowSizeToggle: () => void;
  sidebarPeekSuppressed: boolean;
  onSidebarPeekChange: (suppressed: boolean) => void;
  activeChatProcessing: boolean;
  titleGenInFlight: Record<string, number>;
  appVersion: string | null;
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

export function Sidebar({
  conversations,
  conversationId,
  view,
  onViewChange,
  onConversationSelect,
  onConversationDelete,
  onNewChat,
  compactLayout,
  windowPresetSmall,
  onWindowSizeToggle,
  sidebarPeekSuppressed,
  onSidebarPeekChange,
  activeChatProcessing,
  titleGenInFlight,
  appVersion,
}: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  /** Avoid focusing the search toggle on mount — composer should receive initial focus. */
  const prevSearchOpenRef = useRef<boolean | undefined>(undefined);

  const [sidebarConversationsExpanded, setSidebarConversationsExpanded] = useState(false);
  const [sidebarConversationPreviewCount, setSidebarConversationPreviewCount] = useState(loadSidebarPreviewCount);
  const sidebarPreviewCountRef = useRef(sidebarConversationPreviewCount);
  const [sidebarExpandRowPointerDown, setSidebarExpandRowPointerDown] = useState(false);
  const sidebarPreviewDragRef = useRef<{
    pointerId: number;
    startY: number;
    startCount: number;
    countChanged: boolean;
  } | null>(null);

  useEffect(() => {
    sidebarPreviewCountRef.current = sidebarConversationPreviewCount;
  }, [sidebarConversationPreviewCount]);

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
    } else if (prevSearchOpenRef.current === true) {
      searchButtonRef.current?.focus();
    }
    prevSearchOpenRef.current = searchOpen;
  }, [searchOpen]);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setSearchQuery("");
  }, []);

  const handleSearchResultClick = useCallback(
    (id: string) => {
      onConversationSelect(id);
      onViewChange("chat");
      closeSearch();
    },
    [onConversationSelect, onViewChange, closeSearch]
  );

  useEffect(() => {
    if (conversations.length <= sidebarConversationPreviewCount) {
      setSidebarConversationsExpanded(false);
    }
  }, [conversations.length, sidebarConversationPreviewCount]);

  const onSidebarPreviewResizePointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    sidebarPreviewDragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      startCount: sidebarPreviewCountRef.current,
      countChanged: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setSidebarExpandRowPointerDown(true);
  }, []);

  const onSidebarPreviewResizePointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = sidebarPreviewDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dy = e.clientY - d.startY;
    const next = clampSidebarPreviewCount(d.startCount + Math.round(dy / SIDEBAR_PREVIEW_ROW_PX));
    if (next !== sidebarPreviewCountRef.current) {
      d.countChanged = true;
      sidebarPreviewCountRef.current = next;
      setSidebarConversationPreviewCount(next);
    }
  }, []);

  const onSidebarPreviewResizePointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    setSidebarExpandRowPointerDown(false);
    const d = sidebarPreviewDragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    sidebarPreviewDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (d.countChanged) {
      try {
        localStorage.setItem(SIDEBAR_PREVIEW_STORAGE_KEY, String(sidebarPreviewCountRef.current));
      } catch {
        // ignore
      }
    }
  }, []);

  const sidebarListConversations = useMemo(
    () =>
      pickSidebarConversationsForList(
        conversations,
        sidebarConversationsExpanded,
        conversationId,
        sidebarConversationPreviewCount
      ),
    [conversations, sidebarConversationsExpanded, conversationId, sidebarConversationPreviewCount]
  );

  const { groups: sidebarGroups } = useMemo(
    () => groupConversations(sidebarListConversations),
    [sidebarListConversations]
  );

  const showSidebarConversationExpandControl = conversations.length > sidebarConversationPreviewCount;

  return (
    <div
      className="sidebar-dock"
      onMouseEnter={() => onSidebarPeekChange(false)}
      onMouseLeave={() => onSidebarPeekChange(false)}
      onFocusCapture={() => onSidebarPeekChange(false)}
    >
      {compactLayout ? (
        <button type="button" className="sidebar-edge-hit" aria-label="Open sidebar" />
      ) : null}
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
              <X size={16} />
            </button>
          </div>
        ) : (
          <div className="sidebar-buttons">
            <button
              type="button"
              className="btn sidebar-new-chat-btn"
              data-testid="sidebar-new-chat"
              aria-label="New chat"
              onClick={onNewChat}
            >
              <Plus size={16} className="sidebar-new-chat-icon" aria-hidden />
              <span className="sidebar-new-chat-label">New</span>
            </button>
            <button
              ref={searchButtonRef}
              type="button"
              className="btn btn-icon"
              onClick={() => setSearchOpen(true)}
              aria-label="Search conversations"
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              className="btn btn-icon"
              onClick={onWindowSizeToggle}
              aria-label={windowPresetSmall ? "Expand window" : "Shrink window"}
            >
              {windowPresetSmall ? <Maximize2 size={16} /> : <Minimize2 size={16} />}
            </button>
          </div>
        )}
        {!searchOpen && (
          <nav className="sidebar-workspace" aria-label="Workspace">
            <button
              type="button"
              className={`btn sidebar-workspace__btn${view === "tasks" ? " sidebar-workspace__btn--active" : ""}`}
              onClick={() => onViewChange("tasks")}
              aria-label="Tasks"
              aria-current={view === "tasks" ? "page" : undefined}
            >
              <ListTodo size={16} className="sidebar-workspace__icon" aria-hidden />
              <span className="sidebar-workspace__label">Tasks</span>
            </button>
            <button
              type="button"
              className={`btn sidebar-workspace__btn${view === "writing" ? " sidebar-workspace__btn--active" : ""}`}
              data-testid="sidebar-writing"
              onClick={() => onViewChange("writing")}
              aria-label="Desk"
              aria-current={view === "writing" ? "page" : undefined}
            >
              <NotebookPen size={16} className="sidebar-workspace__icon" aria-hidden />
              <span className="sidebar-workspace__label">Desk</span>
            </button>
            <button
              type="button"
              className={`btn sidebar-workspace__btn${view === "settings" ? " sidebar-workspace__btn--active" : ""}`}
              data-testid="sidebar-settings"
              onClick={() => onViewChange("settings")}
              aria-label="Settings"
              aria-current={view === "settings" ? "page" : undefined}
            >
              <Settings size={16} className="sidebar-workspace__icon" aria-hidden />
              <span className="sidebar-workspace__label">Settings</span>
            </button>
          </nav>
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
                    className={`search-result-item ${conversationId === r.id && view === "chat" ? "active" : ""}`}
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
              {sidebarGroups.map(({ key, label, items }: SidebarGroup) => (
                <li key={key} className="sidebar-group">
                  <span className="sidebar-group-label">{label}</span>
                  <ul className="sidebar-group-items">
                    {items.map((c) => {
                      const rowBusy =
                        view === "chat" &&
                        conversationId === c.id &&
                        (activeChatProcessing || (titleGenInFlight[c.id] ?? 0) > 0);
                      return (
                        <li
                          key={c.id}
                          className={`sidebar-item ${conversationId === c.id && view === "chat" ? "active" : ""}`}
                          data-testid="sidebar-conversation"
                          data-conversation-id={c.id}
                          onClick={() => { onConversationSelect(c.id); onViewChange("chat"); }}
                          aria-busy={rowBusy ? true : undefined}
                        >
                          {rowBusy ? (
                            <span className="sidebar-item-spinner" aria-hidden>
                              <Loader2 size={11} strokeWidth={2.5} className="voice-spinner" />
                            </span>
                          ) : null}
                          <span className="sidebar-item-title">{c.title || formatNewChatLabel(c.createdAt)}</span>
                          <button
                            type="button"
                            className="sidebar-item-delete"
                            onClick={(e) => { e.stopPropagation(); onConversationDelete(c.id); }}
                            aria-label="Delete conversation"
                          >
                            ×
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
              {showSidebarConversationExpandControl ? (
                <li className="sidebar-list-expand">
                  <div className="sidebar-list-expand-row">
                    {!sidebarConversationsExpanded ? (
                      <>
                        <span
                          className={`sidebar-list-expand-drag${sidebarExpandRowPointerDown ? " sidebar-list-expand-drag--pressed" : ""}`}
                          tabIndex={0}
                          title="Drag up or down to change how many conversations are listed in the preview"
                          aria-label="Drag vertically to change how many conversations appear before expanding the list"
                          onPointerDown={onSidebarPreviewResizePointerDown}
                          onPointerMove={onSidebarPreviewResizePointerMove}
                          onPointerUp={onSidebarPreviewResizePointerUp}
                          onPointerCancel={onSidebarPreviewResizePointerUp}
                        >
                          Drag
                        </span>
                        <span className="sidebar-list-expand-sep" aria-hidden="true">
                          ·
                        </span>
                      </>
                    ) : null}
                    {sidebarConversationsExpanded ? (
                      <button
                        type="button"
                        className="btn sidebar-list-expand-btn"
                        data-testid="sidebar-conversations-show-less"
                        aria-label="Show fewer conversations — collapse to preview"
                        onClick={() => setSidebarConversationsExpanded(false)}
                      >
                        Less
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn sidebar-list-expand-btn"
                        data-testid="sidebar-conversations-show-more"
                        aria-label={`Show all ${conversations.length} conversations`}
                        onClick={() => setSidebarConversationsExpanded(true)}
                      >
                        More
                      </button>
                    )}
                  </div>
                </li>
              ) : null}
            </>
          )}
        </ul>
        {appVersion != null && appVersion !== "" ? (
          <div className="sidebar-version" title={`Harness ${appVersion}`}>
            v{appVersion}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
