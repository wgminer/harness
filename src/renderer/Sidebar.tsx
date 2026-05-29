import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import {
  ArrowUpRight,
  Settings,
  Plus,
  Search,
  NotebookText,
  X,
  ListTodo,
  Clipboard,
  Loader2,
  RefreshCw,
  Circle,
  ListFilter,
} from "lucide-react";
import { RIG_PAGE_TITLE } from "../shared/rigPage";
import type { SearchResult } from "../shared/types";
import {
  conversationDisplayTitle,
  conversationSidebarIconKind,
  isConversationTitlePending,
} from "../shared/conversationSession";
import { syncResultChangedLocalData } from "../shared/sync";
import {
  type Conversation,
  type View,
  type SidebarGroup,
  type SidebarListSortMode,
  SIDEBAR_INITIAL_VISIBLE_COUNT,
  SIDEBAR_MORE_INCREMENT,
  computeSidebarListLayout,
  effectiveSidebarPeekLayout,
  groupConversations,
  nextSidebarListSortMode,
  pickSidebarConversationsForList,
  SIDEBAR_LIST_LAYOUT_DEFAULTS,
  sidebarItemPeekFadeLevel,
  sidebarPeekFadeOpacity,
  type SidebarListLayout,
} from "./sidebarUtils";

interface SidebarProps {
  conversations: Conversation[];
  conversationId: string | null;
  view: View;
  onViewChange: (v: View) => void;
  onConversationSelect: (id: string) => void;
  onConversationDelete: (id: string) => void;
  onNewChat: () => void;
  activeChatProcessing: boolean;
  titleGenInFlight: Record<string, number>;
  appVersion: string | null;
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
  activeChatProcessing,
  titleGenInFlight,
  appVersion,
  notesItemActive,
  onNotesClick,
  onSyncComplete,
}: SidebarProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  /** Avoid focusing the search toggle on mount — composer should receive initial focus. */
  const prevSearchOpenRef = useRef<boolean | undefined>(undefined);

  const listWrapRef = useRef<HTMLDivElement>(null);
  const sidebarCapacityRef = useRef(SIDEBAR_INITIAL_VISIBLE_COUNT);
  const [listLayout, setListLayout] = useState<SidebarListLayout>(() =>
    computeSidebarListLayout()
  );
  const [sidebarVisibleLimit, setSidebarVisibleLimit] = useState(SIDEBAR_INITIAL_VISIBLE_COUNT);
  const [listSortMode, setListSortMode] = useState<SidebarListSortMode>("recent");
  const [syncConfigured, setSyncConfigured] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);

  const refreshSyncConfigured = useCallback(() => {
    void window.electron.sync.getStatus().then((status) => {
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
      const result = await window.electron.sync.runNow();
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
  const sidebarPeekFadeActive = sidebarVisibleLimit <= listLayout.initialVisibleCount;
  const peekLayout = useMemo(
    () => effectiveSidebarPeekLayout(listLayout, sidebarListConversations.length),
    [listLayout, sidebarListConversations.length]
  );

  useLayoutEffect(() => {
    if (searchOpen) return;
    const wrap = listWrapRef.current;
    if (!wrap) return;

    const measure = () => {
      const list = wrap.querySelector<HTMLElement>(".sidebar-list");
      const sampleItem = wrap.querySelector<HTMLElement>(".sidebar-item");
      const groupHeader = wrap.querySelector<HTMLElement>(
        ".sidebar-group-header, .sidebar-group-label"
      );
      const expandRow = wrap.querySelector<HTMLElement>(".sidebar-list-expand");

      let listPaddingPx: number | undefined;
      if (list) {
        const styles = getComputedStyle(list);
        listPaddingPx =
          (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
      }

      const layout = computeSidebarListLayout({
        listAreaHeightPx: wrap.clientHeight,
        rowHeightPx: sampleItem?.offsetHeight,
        groupHeaderHeightPx: groupHeader?.offsetHeight,
        expandRowHeightPx:
          expandRow?.offsetHeight ??
          (conversations.length > sidebarCapacityRef.current
            ? SIDEBAR_LIST_LAYOUT_DEFAULTS.expandRowHeightPx
            : 0),
        listPaddingPx,
      });

      setListLayout(layout);
      const prevCapacity = sidebarCapacityRef.current;
      sidebarCapacityRef.current = layout.initialVisibleCount;
      setSidebarVisibleLimit((prev) => {
        if (prev <= prevCapacity) return layout.initialVisibleCount;
        return prev;
      });
    };

    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(measure);
      ro.observe(wrap);
    }
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [searchOpen, conversations.length, sidebarListConversations.length]);

  const onSidebarShowMore = useCallback(() => {
    setSidebarVisibleLimit((n) => Math.min(conversations.length, n + SIDEBAR_MORE_INCREMENT));
  }, [conversations.length]);

  const renderConversationItem = useCallback(
    (c: Conversation, flatIndex: number) => {
      const isActive = conversationId === c.id && view === "chat";
      const peekFadeLevel =
        !isActive && sidebarPeekFadeActive
          ? sidebarItemPeekFadeLevel(flatIndex, peekLayout.previewCount, peekLayout.fadePeekCount)
          : null;
      const peekOpacity =
        peekFadeLevel != null
          ? sidebarPeekFadeOpacity(peekFadeLevel, peekLayout.fadePeekCount)
          : null;
      const titleGenerating = (titleGenInFlight[c.id] ?? 0) > 0;
      const titlePending = isConversationTitlePending(c.title, titleGenerating);
      const chatStreaming =
        view === "chat" && conversationId === c.id && activeChatProcessing;
      const iconKind = conversationSidebarIconKind(c);
      const Icon = iconKind === "dictation" ? ArrowUpRight : Circle;
      const isTailItem = sidebarPeekFadeActive && flatIndex >= peekLayout.previewCount;
      return (
        <li
          key={c.id}
          className={[
            "sidebar-item",
            isActive ? "active" : "",
            isTailItem ? "sidebar-list-tail-item" : "",
            peekFadeLevel != null ? "sidebar-item--peek-fade" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={
            peekOpacity != null
              ? ({
                  "--sidebar-peek-opacity": String(peekOpacity),
                  "--sidebar-peek-reveal-delay": `${(peekFadeLevel! - 1) * 60}ms`,
                } satisfies CSSProperties)
              : undefined
          }
          data-peek-inert={peekOpacity === 0 ? "true" : undefined}
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
            ×
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
      peekLayout.fadePeekCount,
      peekLayout.previewCount,
      sidebarPeekFadeActive,
      sidebarVisibleLimit,
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
              className={`btn list-item-base sidebar-workspace__btn${view === "clippings" ? " active" : ""}`}
              data-testid="sidebar-clippings"
              onClick={() => onViewChange("clippings")}
              aria-label="Clippings"
              aria-current={view === "clippings" ? "page" : undefined}
            >
              <Clipboard size={16} className="sidebar-workspace__icon" aria-hidden />
              <span className="sidebar-workspace__label">Clippings</span>
            </button>
            <button
              type="button"
              className={`btn list-item-base sidebar-workspace__btn${notesItemActive ? " active" : ""}`}
              data-testid="sidebar-notes"
              onClick={onNotesClick}
              aria-label="Notes"
              aria-current={notesItemActive ? "page" : undefined}
            >
              <NotebookText size={16} className="sidebar-workspace__icon" aria-hidden />
              <span className="sidebar-workspace__label">Notes</span>
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
          ref={listWrapRef}
          className={`sidebar-list-wrap${sidebarPeekFadeActive ? " sidebar-list-wrap--peek-fade" : ""}`}
          style={
            sidebarPeekFadeActive
              ? ({
                  "--sidebar-peek-expand-reveal-delay": `${peekLayout.fadePeekCount * 60}ms`,
                } satisfies CSSProperties)
              : undefined
          }
        >
          <div className="sidebar-list__fade-top" aria-hidden />
          <div className="sidebar-list__fade-bottom" aria-hidden />
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
              {(() => {
                let flatConversationIndex = 0;
                return sidebarGroups.map(({ key, label, items }: SidebarGroup, groupIndex) => (
                <li key={key} className="sidebar-group">
                  {groupIndex === 0 ? (
                    <div className="sidebar-group-header">
                      <span className="sidebar-group-label">{label}</span>
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
                    <span className="sidebar-group-label">{label}</span>
                  )}
                  <ul className="sidebar-group-items">
                    {items.map((c) => renderConversationItem(c, flatConversationIndex++))}
                  </ul>
                </li>
              ));
              })()}
              {showSidebarMoreControl ? (
                <li
                  className={[
                    "sidebar-list-expand",
                    sidebarPeekFadeActive ? "sidebar-list-tail-item" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
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
