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
  StickyNote,
  Image as ImageIcon,
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
import { getDisplayNoteTitle, type NoteSummary } from "../shared/writing";
import { getDisplayImageTitle, type GeneratedImage } from "../shared/images";
import { syncResultChangedLocalData } from "../shared/sync";
import type { UpdateStatus } from "../shared/updateStatus";
import {
  type Conversation,
  type LibraryRow,
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
  notes: NoteSummary[];
  images: GeneratedImage[];
  conversationId: string | null;
  activeNoteId: string | null;
  activeImageId: string | null;
  view: View;
  onViewChange: (v: View) => void;
  onConversationSelect: (id: string) => void;
  onConversationDelete: (id: string) => void;
  onSelectNote: (id: string) => void;
  onNoteDelete: (id: string) => void;
  onSelectImage: (id: string) => void;
  onImageDelete: (id: string) => void;
  onNewChat: () => void;
  onNewNote: () => void;
  onNewImage: () => void;
  activeChatProcessing: boolean;
  titleGenInFlight: Record<string, number>;
  appVersion: string | null;
  updateStatus: UpdateStatus;
  onUpdateClick: () => void;
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
  notes,
  images,
  conversationId,
  activeNoteId,
  activeImageId,
  view,
  onViewChange,
  onConversationSelect,
  onConversationDelete,
  onSelectNote,
  onNoteDelete,
  onSelectImage,
  onImageDelete,
  onNewChat,
  onNewNote,
  onNewImage,
  activeChatProcessing,
  titleGenInFlight,
  appVersion,
  updateStatus,
  onUpdateClick,
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
  const modKey = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";
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

  const libraryRows = useMemo<LibraryRow[]>(
    () => [
      ...conversations.map((c): LibraryRow => ({ ...c, itemKind: "conversation" })),
      ...notes.map(
        (n): LibraryRow => ({
          id: n.id,
          title: n.title,
          createdAt: n.updatedAt,
          itemKind: "note",
        })
      ),
      ...images.map(
        (img): LibraryRow => ({
          id: img.id,
          title: img.title,
          createdAt: img.updatedAt,
          itemKind: "image",
        })
      ),
    ],
    [conversations, notes, images]
  );

  const sidebarListItems = useMemo(
    () =>
      pickSidebarConversationsForList(
        libraryRows,
        conversationId ?? activeNoteId ?? activeImageId,
        sidebarVisibleLimit,
      ),
    [libraryRows, conversationId, activeNoteId, activeImageId, sidebarVisibleLimit]
  );

  const { groups: sidebarGroups } = useMemo(
    () => groupConversations(sidebarListItems, listSortMode),
    [sidebarListItems, listSortMode]
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

  const showSidebarMoreControl = sidebarListItems.length < libraryRows.length;

  const onSidebarShowMore = useCallback(() => {
    setSidebarVisibleLimit((n) => Math.min(libraryRows.length, n + SIDEBAR_MORE_INCREMENT));
  }, [libraryRows.length]);

  const noteSearchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return notes.filter((n) => getDisplayNoteTitle(n.title).toLowerCase().includes(q));
  }, [notes, searchQuery]);

  const imageSearchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return images.filter((img) => getDisplayImageTitle(img.title).toLowerCase().includes(q));
  }, [images, searchQuery]);

  const renderLibraryItem = useCallback(
    (row: LibraryRow) => {
      if (row.itemKind === "note") {
        const isActive = view === "notes" && activeNoteId === row.id;
        return (
          <li
            key={row.id}
            className={["sidebar-item", isActive ? "active" : ""].filter(Boolean).join(" ")}
            data-testid="sidebar-note"
            data-note-id={row.id}
            onClick={() => onSelectNote(row.id)}
          >
            <span className="sidebar-item-icon" aria-hidden title="Note">
              <StickyNote size={16} className="sidebar-item-icon__svg" />
            </span>
            <span className="sidebar-item-title">{getDisplayNoteTitle(row.title ?? "")}</span>
            <button
              type="button"
              className="sidebar-item-delete"
              onClick={(e) => {
                e.stopPropagation();
                onNoteDelete(row.id);
              }}
              aria-label="Delete note"
            >
              <X size={12} strokeWidth={2.5} aria-hidden />
            </button>
          </li>
        );
      }
      if (row.itemKind === "image") {
        const isActive = view === "images" && activeImageId === row.id;
        return (
          <li
            key={row.id}
            className={["sidebar-item", isActive ? "active" : ""].filter(Boolean).join(" ")}
            data-testid="sidebar-image"
            data-image-id={row.id}
            onClick={() => onSelectImage(row.id)}
          >
            <span className="sidebar-item-icon" aria-hidden title="Image">
              <ImageIcon size={16} className="sidebar-item-icon__svg" />
            </span>
            <span className="sidebar-item-title">{getDisplayImageTitle(row.title)}</span>
            <button
              type="button"
              className="sidebar-item-delete"
              onClick={(e) => {
                e.stopPropagation();
                onImageDelete(row.id);
              }}
              aria-label="Delete image"
            >
              <X size={12} strokeWidth={2.5} aria-hidden />
            </button>
          </li>
        );
      }
      const c = row as Conversation;
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
      activeImageId,
      activeNoteId,
      conversationId,
      onConversationDelete,
      onConversationSelect,
      onImageDelete,
      onNoteDelete,
      onSelectImage,
      onSelectNote,
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
              placeholder="Search…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") closeSearch();
              }}
              aria-label="Search"
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
                    <span>New chat</span>
                    <span className="sidebar-new-menu-item__shortcut" aria-hidden>
                      {modKey}N
                    </span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-new-menu-item"
                    role="menuitem"
                    data-testid="sidebar-new-note"
                    onClick={() => {
                      setNewMenuOpen(false);
                      onNewNote();
                    }}
                  >
                    <span>New note</span>
                    <span className="sidebar-new-menu-item__shortcut" aria-hidden>
                      ⇧{modKey}N
                    </span>
                  </button>
                  <button
                    type="button"
                    className="sidebar-new-menu-item"
                    role="menuitem"
                    data-testid="sidebar-new-image"
                    onClick={() => {
                      setNewMenuOpen(false);
                      onNewImage();
                    }}
                  >
                    <span>New image</span>
                  </button>
                </div>
              ) : null}
            </div>
            <button
              ref={searchButtonRef}
              type="button"
              className="btn btn-icon"
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
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
              searchLoading && noteSearchMatches.length === 0 && imageSearchMatches.length === 0 ? (
                <li className="sidebar-search-empty">Searching…</li>
              ) : searchResults.length === 0 &&
                noteSearchMatches.length === 0 &&
                imageSearchMatches.length === 0 ? (
                <li className="sidebar-search-empty">No results</li>
              ) : (
                <>
                  {noteSearchMatches.map((n) => (
                    <li
                      key={n.id}
                      className={`search-result-item ${view === "notes" && activeNoteId === n.id ? "active" : ""}`}
                      onClick={() => {
                        onSelectNote(n.id);
                        closeSearch();
                      }}
                    >
                      <span className="search-result-title">{getDisplayNoteTitle(n.title)}</span>
                    </li>
                  ))}
                  {imageSearchMatches.map((img) => (
                    <li
                      key={img.id}
                      className={`search-result-item ${view === "images" && activeImageId === img.id ? "active" : ""}`}
                      onClick={() => {
                        onSelectImage(img.id);
                        closeSearch();
                      }}
                    >
                      <span className="search-result-title">{getDisplayImageTitle(img.title)}</span>
                    </li>
                  ))}
                  {searchResults.map((r) => (
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
                  ))}
                </>
              )
            ) : (
              <li className="sidebar-search-empty">Type to search</li>
            )
          ) : (
            <>
              {sidebarGroups.map(({ key, label, items }: SidebarGroup, groupIndex) => {
                const groupLabelTitle =
                  key === "recent"
                    ? `${libraryRows.length} item${libraryRows.length === 1 ? "" : "s"}`
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
                    {items.map((row) => renderLibraryItem(row))}
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
                      aria-label={`Show ${SIDEBAR_MORE_INCREMENT} more items`}
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
