import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  ArrowUpRight,
  Settings,
  Plus,
  Search,
  SquarePen,
  X,
  ListTodo,
  Loader2,
  RefreshCw,
  Circle,
  ListFilter,
  ChevronDown,
} from "lucide-react";
import { RIG_PAGE_TITLE } from "../shared/rigPage";
import type { SearchResult } from "../shared/types";
import {
  conversationDisplayTitle,
  conversationSidebarIconKind,
  isConversationTitlePending,
} from "../shared/conversationSession";
import { syncResultChangedLocalData } from "../shared/sync";
import type { UpdateStatus } from "../shared/updateStatus";
import {
  type Conversation,
  type View,
  type SidebarGroup,
  type SidebarListSortMode,
  SIDEBAR_INITIAL_VISIBLE_COUNT,
  SIDEBAR_MORE_INCREMENT,
  groupConversations,
  nextSidebarListSortMode,
  pickSidebarConversationsForList,
} from "./sidebarUtils";
import { useScrollFadeEdges } from "./useScrollFadeEdges";

interface SidebarProps {
  conversations: Conversation[];
  conversationId: string | null;
  view: View;
  onViewChange: (v: View) => void;
  onConversationSelect: (id: string) => void;
  onConversationDelete: (id: string) => void;
  onNewChat: () => void;
  onNewNote: () => void;
  openNoteInStickyWindow: boolean;
  onOpenNoteInStickyWindowChange: (value: boolean) => void;
  activeChatProcessing: boolean;
  titleGenInFlight: Record<string, number>;
  appVersion: string | null;
  updateStatus: UpdateStatus;
  onUpdateClick: () => void;
  notesItemActive: boolean;
  onNotesClick: () => void;
  /** Called after sync when local conversation data may have changed. */
  onSyncComplete?: () => void;
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
  onNewNote,
  openNoteInStickyWindow,
  onOpenNoteInStickyWindowChange,
  activeChatProcessing,
  titleGenInFlight,
  appVersion,
  updateStatus,
  onUpdateClick,
  notesItemActive,
  onNotesClick,
  onSyncComplete,
}: SidebarProps) {
  const updateButtonLabel = (() => {
    switch (updateStatus.status) {
      case "available":
        return updateStatus.version ? `Update to v${updateStatus.version}` : "Update";
      case "downloading":
        return `Updating… ${updateStatus.percent}%`;
      case "ready":
        return "Restarting…";
      case "checking":
        return "Checking…";
      default:
        return "Update";
    }
  })();

  const showUpdateButton =
    updateStatus.status === "available" ||
    updateStatus.status === "downloading" ||
    updateStatus.status === "ready" ||
    updateStatus.status === "checking";

  const updateButtonDisabled =
    updateStatus.status === "downloading" ||
    updateStatus.status === "ready" ||
    updateStatus.status === "checking";

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  /** Avoid focusing the search toggle on mount — composer should receive initial focus. */
  const prevSearchOpenRef = useRef<boolean | undefined>(undefined);

  const [sidebarVisibleLimit, setSidebarVisibleLimit] = useState(SIDEBAR_INITIAL_VISIBLE_COUNT);
  const [listSortMode, setListSortMode] = useState<SidebarListSortMode>("recent");
  const [syncConfigured, setSyncConfigured] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const { scrollRef: sidebarListRef, fadeTop, fadeBottom, onScroll: onSidebarListScroll } =
    useScrollFadeEdges();

  const refreshSyncConfigured = useCallback(() => {
    void window.harness.sync.getStatus().then((status) => {
      setSyncConfigured(status.configured);
    });
  }, []);

  useEffect(() => {
    refreshSyncConfigured();
  }, [refreshSyncConfigured]);

  useEffect(() => {
    if (view === "settings") return;
    refreshSyncConfigured();
  }, [view, refreshSyncConfigured]);

  const runSidebarSync = useCallback(async () => {
    if (syncBusy || !syncConfigured) return;
    setSyncBusy(true);
    try {
      const result = await window.harness.sync.runNow();
      setSyncConfigured(result.status.configured);
      if (syncResultChangedLocalData(result)) {
        onSyncComplete?.();
      }
    } finally {
      setSyncBusy(false);
    }
  }, [syncBusy, syncConfigured, onSyncComplete]);

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
      window.harness.memory.searchConversations(trimmed, true).then((results) => {
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

  useEffect(() => {
    if (!newMenuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNewMenuOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      const el = newMenuRef.current;
      if (el && !el.contains(e.target as Node)) setNewMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onPointerDown);
    };
  }, [newMenuOpen]);

  const handleSearchResultClick = useCallback(
    (id: string) => {
      onConversationSelect(id);
      onViewChange("chat");
    },
    [onConversationSelect, onViewChange]
  );

  const sidebarListConversations = useMemo(
    () =>
      pickSidebarConversationsForList(conversations, conversationId, sidebarVisibleLimit),
    [conversations, conversationId, sidebarVisibleLimit]
  );

  const { groups: sidebarGroups } = useMemo(
    () => groupConversations(sidebarListConversations, listSortMode),
    [sidebarListConversations, listSortMode]
  );

  const toggleListSortMode = useCallback(() => {
    setListSortMode((mode) => nextSidebarListSortMode(mode));
  }, []);

  const nextSortModeHint =
    listSortMode === "date"
      ? { ariaLabel: "Switch to Recent list", title: "Sort by recent activity" }
      : listSortMode === "recent"
        ? { ariaLabel: "Switch to calendar day groups", title: "Group by calendar day" }
        : { ariaLabel: "Switch to time-ago groups", title: "Group by time ago" };

  const showSidebarMoreControl = sidebarListConversations.length < conversations.length;

  const onSidebarShowMore = useCallback(() => {
    setSidebarVisibleLimit((n) => Math.min(conversations.length, n + SIDEBAR_MORE_INCREMENT));
  }, [conversations.length]);

  const renderConversationItem = useCallback(
    (c: Conversation) => {
      const isActive = conversationId === c.id && view === "chat";
      const titleGenerating = (titleGenInFlight[c.id] ?? 0) > 0;
      const titlePending = isConversationTitlePending(c.title, titleGenerating);
      const chatStreaming =
        view === "chat" && conversationId === c.id && activeChatProcessing;
      const iconKind = conversationSidebarIconKind(c);
      const Icon = iconKind === "dictation" ? ArrowUpRight : Circle;
      return (
        <li
          key={c.id}
          className={["sidebar-item", isActive ? "active" : ""].filter(Boolean).join(" ")}
          data-testid="sidebar-conversation"
          data-conversation-id={c.id}
          data-session-icon={iconKind}
          onClick={() => {
            onConversationSelect(c.id);
            onViewChange("chat");
          }}
          aria-busy={titlePending || chatStreaming ? true : undefined}
        >
          {chatStreaming ? (
            <span className="sidebar-item-spinner" aria-hidden>
              <Loader2 size={16} className="voice-spinner" />
            </span>
          ) : (
            <span
              className="sidebar-item-icon"
              aria-hidden
              title={iconKind === "dictation" ? "Dictation" : "Chat"}
            >
              <Icon size={16} className="sidebar-item-icon__svg" />
            </span>
          )}
          {titlePending ? (
            <span className="sidebar-item-title-skeleton" aria-label="Generating title" />
          ) : (
            <span className="sidebar-item-title">
              {conversationDisplayTitle(c.title, c.createdAt)}
            </span>
          )}
          <button
            type="button"
            className="sidebar-item-delete"
            onClick={(e) => {
              e.stopPropagation();
              onConversationDelete(c.id);
            }}
            aria-label="Delete conversation"
          >
            <X size={12} strokeWidth={2.5} aria-hidden />
          </button>
        </li>
      );
    },
    [
      activeChatProcessing,
      conversationId,
      onConversationDelete,
      onConversationSelect,
      onViewChange,
      titleGenInFlight,
      view,
    ]
  );

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
            <div className="sidebar-new-menu-wrap" ref={newMenuRef}>
              <button
                type="button"
                className="btn sidebar-new-chat-btn"
                data-testid="sidebar-new-menu"
                aria-label="New"
                aria-haspopup="menu"
                aria-expanded={newMenuOpen}
                onClick={() => setNewMenuOpen((open) => !open)}
              >
                <Plus size={16} className="sidebar-new-chat-icon" aria-hidden />
                <span className="sidebar-new-chat-label">New</span>
                <ChevronDown size={14} className="sidebar-new-menu-chevron" aria-hidden />
              </button>
              {newMenuOpen ? (
                <div className="sidebar-new-menu" role="menu" aria-label="Create new">
                  <button
                    type="button"
                    className="sidebar-new-menu-item"
                    role="menuitem"
                    data-testid="sidebar-new-chat"
                    onClick={() => {
                      setNewMenuOpen(false);
                      onNewChat();
                    }}
                  >
                    New chat
                  </button>
                  <div className="sidebar-new-menu-item sidebar-new-menu-item--note" role="none">
                    <button
                      type="button"
                      className="sidebar-new-menu-item__action"
                      role="menuitem"
                      data-testid="sidebar-new-note"
                      onClick={() => {
                        setNewMenuOpen(false);
                        onNewNote();
                      }}
                    >
                      New note
                    </button>
                    <label className="sidebar-new-menu-switch settings-switch-row settings-switch-row--static">
                      <input
                        type="checkbox"
                        className="settings-switch-input"
                        checked={openNoteInStickyWindow}
                        onChange={(e) => onOpenNoteInStickyWindowChange(e.target.checked)}
                        aria-label="Open note in new window"
                        data-testid="sidebar-new-note-sticky-toggle"
                      />
                      <span className="settings-switch-track" aria-hidden="true">
                        <span className="settings-switch-thumb" />
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}
            </div>
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
              className={`btn list-item-base sidebar-workspace__btn${view === "tasks" ? " active" : ""}`}
              onClick={() => onViewChange("tasks")}
              aria-label="Tasks"
              aria-current={view === "tasks" ? "page" : undefined}
            >
              <ListTodo size={16} className="sidebar-workspace__icon" aria-hidden />
              <span className="sidebar-workspace__label">Tasks</span>
            </button>
            <button
              type="button"
              className={`btn list-item-base sidebar-workspace__btn${notesItemActive ? " active" : ""}`}
              data-testid="sidebar-notes"
              onClick={onNotesClick}
              aria-label="Editor"
              aria-current={notesItemActive ? "page" : undefined}
            >
              <SquarePen size={16} className="sidebar-workspace__icon" aria-hidden />
              <span className="sidebar-workspace__label">Editor</span>
            </button>
            <button
              type="button"
              className={`btn list-item-base sidebar-workspace__btn${view === "settings" ? " active" : ""}`}
              data-testid="sidebar-settings"
              onClick={() => onViewChange("settings")}
              aria-label={RIG_PAGE_TITLE}
              aria-current={view === "settings" ? "page" : undefined}
            >
              <Settings size={16} className="sidebar-workspace__icon" aria-hidden />
              <span className="sidebar-workspace__label">{RIG_PAGE_TITLE}</span>
            </button>
          </nav>
        )}
        <div
          className={[
            "sidebar-list-wrap",
            fadeTop ? "sidebar-list-wrap--fade-top" : "",
            fadeBottom ? "sidebar-list-wrap--fade-bottom" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <ul ref={sidebarListRef} className="sidebar-list" onScroll={onSidebarListScroll}>
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
                        text={conversationDisplayTitle(r.title, r.createdAt)}
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
              {sidebarGroups.map(({ key, label, items }: SidebarGroup, groupIndex) => {
                const groupLabelTitle =
                  key === "recent"
                    ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`
                    : undefined;
                return (
                <li key={key} className="sidebar-group">
                  {groupIndex === 0 ? (
                    <div className="sidebar-group-header">
                      <span className="sidebar-group-label" title={groupLabelTitle}>
                        {label}
                      </span>
                      <button
                        type="button"
                        className="btn btn-icon sidebar-group-sort-toggle"
                        data-testid="sidebar-list-sort-toggle"
                        aria-label={nextSortModeHint.ariaLabel}
                        title={nextSortModeHint.title}
                        onClick={toggleListSortMode}
                      >
                        <ListFilter size={10} aria-hidden />
                      </button>
                    </div>
                  ) : (
                    <span className="sidebar-group-label" title={groupLabelTitle}>
                      {label}
                    </span>
                  )}
                  <ul className="sidebar-group-items">
                    {items.map((c) => renderConversationItem(c))}
                  </ul>
                </li>
                );
              })}
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
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-footer__meta">
            {appVersion != null && appVersion !== "" ? (
              <span className="sidebar-version" title={`Harness ${appVersion}`}>
                v{appVersion}
              </span>
            ) : null}
            {showUpdateButton ? (
              <button
                type="button"
                className="btn sidebar-footer__update-btn"
                data-testid="sidebar-update"
                onClick={onUpdateClick}
                disabled={updateButtonDisabled}
                title={updateButtonLabel}
              >
                {updateButtonLabel}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-icon sidebar-footer__sync-toggle"
            data-testid="sidebar-sync"
            onClick={() => void runSidebarSync()}
            disabled={syncBusy || !syncConfigured}
            aria-label={syncBusy ? "Syncing" : "Sync now"}
            title={
              syncBusy
                ? "Syncing…"
                : syncConfigured
                  ? "Sync now"
                  : `Set up a backup folder in ${RIG_PAGE_TITLE}`
            }
          >
            {syncBusy ? <Loader2 size={14} className="voice-spinner" /> : <RefreshCw size={14} />}
          </button>
        </div>
      </aside>
    </div>
  );
}
