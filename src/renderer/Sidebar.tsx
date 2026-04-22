import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Settings, Minimize2, Plus, Search, SquarePen, X, ListTodo, Loader2 } from "lucide-react";
import type { SearchResult } from "../shared/types";
import { formatNewChatLabel } from "./chatDisplayTitle";
import {
  type Conversation,
  type View,
  type SidebarGroup,
  SIDEBAR_MORE_INCREMENT,
  SIDEBAR_PREVIEW_COUNT_DEFAULT,
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
  /** When true (compact window), shrink control is hidden — no in-app expand control. */
  windowPresetSmall: boolean;
  onWindowSizeToggle: () => void;
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
  windowPresetSmall,
  onWindowSizeToggle,
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

  const [sidebarVisibleLimit, setSidebarVisibleLimit] = useState(SIDEBAR_PREVIEW_COUNT_DEFAULT);

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

  const sidebarListConversations = useMemo(
    () =>
      pickSidebarConversationsForList(conversations, conversationId, sidebarVisibleLimit),
    [conversations, conversationId, sidebarVisibleLimit]
  );

  const { groups: sidebarGroups } = useMemo(
    () => groupConversations(sidebarListConversations),
    [sidebarListConversations]
  );

  const showSidebarMoreControl = sidebarListConversations.length < conversations.length;

  const onSidebarShowMore = useCallback(() => {
    setSidebarVisibleLimit((n) => Math.min(conversations.length, n + SIDEBAR_MORE_INCREMENT));
  }, [conversations.length]);

  return (
    <div className="sidebar-dock">
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
              <span className="sidebar-workspace__label">
                <span>Tasks</span>
                <span className="sidebar-workspace__wip-tag" aria-hidden>
                  WIP
                </span>
              </span>
            </button>
            <button
              type="button"
              className={`btn sidebar-workspace__btn${view === "writing" ? " sidebar-workspace__btn--active" : ""}`}
              data-testid="sidebar-writing"
              onClick={() => onViewChange("writing")}
              aria-label="Desk"
              aria-current={view === "writing" ? "page" : undefined}
            >
              <SquarePen size={16} className="sidebar-workspace__icon" aria-hidden />
              <span className="sidebar-workspace__label">
                <span>Desk</span>
                <span className="sidebar-workspace__wip-tag" aria-hidden>
                  WIP
                </span>
              </span>
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
              {showSidebarMoreControl ? (
                <li className="sidebar-list-expand">
                  <div className="sidebar-list-expand-row">
                    <button
                      type="button"
                      className="btn sidebar-list-expand-btn"
                      data-testid="sidebar-conversations-show-more"
                      aria-label={`Show ${SIDEBAR_MORE_INCREMENT} more conversations`}
                      onClick={onSidebarShowMore}
                    >
                      More
                    </button>
                  </div>
                </li>
              ) : null}
            </>
          )}
        </ul>
        <div className="sidebar-footer">
          <div className="sidebar-footer__meta">
            {appVersion != null && appVersion !== "" ? (
              <span className="sidebar-version" title={`Harness ${appVersion}`}>
                v{appVersion}
              </span>
            ) : null}
          </div>
          {!windowPresetSmall ? (
            <button
              type="button"
              className="btn btn-icon sidebar-footer__window-toggle"
              onClick={onWindowSizeToggle}
              aria-label="Shrink window"
              title="Shrink window"
            >
              <Minimize2 size={14} />
            </button>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
