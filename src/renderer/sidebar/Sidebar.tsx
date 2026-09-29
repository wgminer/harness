import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { X, Loader2 } from "lucide-react";
import {
  conversationDisplayTitle,
  conversationSidebarIconKind,
  isConversationTitlePending,
} from "../../shared/conversationSession";
import { getDisplayNoteTitle, type NoteSummary } from "../../shared/writing";
import { getDisplayImageTitle, type GeneratedImage } from "../../shared/images";
import {
  isUpdateButtonDisabled,
  shouldShowUpdateButton,
  updateButtonLabel,
  updateButtonTitle,
  type UpdateStatus,
} from "../../shared/updateStatus";
import { Skeleton } from "../ui/Skeleton";
import { SidebarKindGlyph, type SidebarGlyphKind } from "./SidebarKindGlyph";
import {
  type Conversation,
  type LibraryRow,
  type View,
  type DevView,
  type SidebarGroup,
  type SidebarLibraryFilter,
  type SidebarListSortMode,
  SIDEBAR_PAGE_SIZE,
  UNTITLED_NOTE_LABEL,
  groupConversations,
  isUntitledNoteTitle,
  libraryRowMatchesFilter,
  pickSidebarLibraryRows,
  sidebarLibraryFilterLabel,
} from "./sidebarUtils";
import { SidebarListMenu } from "./SidebarListMenu";
import { useScrollFadeEdges } from "../hooks/useScrollFadeEdges";

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
  activeChatProcessing: boolean;
  /** Image ids currently generating/adjusting — show sidebar spinner. */
  processingImageIds?: Record<string, true>;
  titleGenInFlight: Record<string, number>;
  titleAwaitingIds: Record<string, true>;
  appVersion: string | null;
  updateStatus: UpdateStatus;
  onUpdateClick: () => void;
  showDevSection?: boolean;
  onDevViewSelect?: (v: DevView) => void;
  /** Library ids recently pulled from R2. */
  arrivedLibraryIds?: Record<string, number>;
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
  activeChatProcessing,
  processingImageIds = {},
  titleGenInFlight,
  titleAwaitingIds,
  appVersion,
  updateStatus,
  onUpdateClick,
  showDevSection = false,
  onDevViewSelect,
  arrivedLibraryIds = {},
}: SidebarProps) {
  const updateLabel = updateButtonLabel(updateStatus);
  const showUpdateButton = shouldShowUpdateButton(updateStatus);
  const updateButtonDisabled = isUpdateButtonDisabled(updateStatus);

  const [sidebarVisibleLimit, setSidebarVisibleLimit] = useState(SIDEBAR_PAGE_SIZE);
  const [listSortMode, setListSortMode] = useState<SidebarListSortMode>("date");
  const [libraryFilter, setLibraryFilter] = useState<SidebarLibraryFilter>("all");

  const { scrollRef: sidebarListRef, fadeTop, fadeBottom, onScroll: onSidebarListScroll } =
    useScrollFadeEdges();

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

  const filteredLibraryRows = useMemo(
    () => libraryRows.filter((row) => libraryRowMatchesFilter(row, libraryFilter)),
    [libraryRows, libraryFilter]
  );

  const onLibraryFilterChange = useCallback((filter: SidebarLibraryFilter) => {
    setLibraryFilter(filter);
    setSidebarVisibleLimit(SIDEBAR_PAGE_SIZE);
  }, []);

  const sidebarListItems = useMemo(
    () =>
      pickSidebarLibraryRows(
        filteredLibraryRows,
        conversationId ?? activeNoteId ?? activeImageId,
        sidebarVisibleLimit
      ),
    [filteredLibraryRows, conversationId, activeNoteId, activeImageId, sidebarVisibleLimit]
  );

  const { groups: sidebarGroups } = useMemo(
    () => groupConversations(sidebarListItems, listSortMode),
    [sidebarListItems, listSortMode]
  );

  const showSidebarMoreControl = sidebarListItems.length < filteredLibraryRows.length;

  const onSidebarShowMore = useCallback(() => {
    setSidebarVisibleLimit((n) => Math.min(filteredLibraryRows.length, n + SIDEBAR_PAGE_SIZE));
  }, [filteredLibraryRows.length]);

  // Load the next page as the list nears its end, and keep filling until it can scroll.
  const loadMoreIfNearEnd = useCallback(() => {
    const el = sidebarListRef.current;
    if (!el || !showSidebarMoreControl) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120) onSidebarShowMore();
  }, [sidebarListRef, showSidebarMoreControl, onSidebarShowMore]);

  useEffect(() => {
    loadMoreIfNearEnd();
  }, [loadMoreIfNearEnd, sidebarListItems.length]);

  const onListScroll = useCallback(() => {
    onSidebarListScroll();
    loadMoreIfNearEnd();
  }, [onSidebarListScroll, loadMoreIfNearEnd]);

  const filterLabel = sidebarLibraryFilterLabel(libraryFilter);
  const renderListMenu = (label: ReactNode, title?: string) => (
    <SidebarListMenu
      label={label}
      title={title}
      filter={libraryFilter}
      onFilterChange={onLibraryFilterChange}
      sortMode={listSortMode}
      onSortModeChange={setListSortMode}
    />
  );

  const renderDevItem = useCallback(
    (devView: DevView, label: string, glyph: SidebarGlyphKind) => {
      const isActive = view === devView;
      return (
        <li
          key={devView}
          className={["sidebar-item", isActive ? "active" : ""].filter(Boolean).join(" ")}
          data-testid={`sidebar-dev-${devView}`}
          onClick={() => onDevViewSelect?.(devView)}
        >
          <SidebarKindGlyph kind={glyph} />
          <span className="sidebar-item-title">{label}</span>
        </li>
      );
    },
    [onDevViewSelect, view],
  );

  const renderLibraryItem = useCallback(
    (row: LibraryRow) => {
      if (row.itemKind === "note") {
        const isActive = view === "notes" && activeNoteId === row.id;
        return (
          <li
            key={row.id}
            className={[
              "sidebar-item",
              isActive ? "active" : "",
              arrivedLibraryIds[row.id] ? "sidebar-item--arrived" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid="sidebar-note"
            data-note-id={row.id}
            data-kind="note"
            onClick={() => onSelectNote(row.id)}
          >
            <SidebarKindGlyph kind="note" />
            {(() => {
              const noteTitle = getDisplayNoteTitle(row.title ?? "");
              return isUntitledNoteTitle(noteTitle) ? (
                <span className="sidebar-item-title sidebar-item-title--untitled">
                  {UNTITLED_NOTE_LABEL}
                </span>
              ) : (
                <span className="sidebar-item-title">{noteTitle}</span>
              );
            })()}
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
        const imageGenerating = Boolean(processingImageIds[row.id]);
        return (
          <li
            key={row.id}
            className={[
              "sidebar-item",
              isActive ? "active" : "",
              arrivedLibraryIds[row.id] ? "sidebar-item--arrived" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid="sidebar-image"
            data-image-id={row.id}
            onClick={() => onSelectImage(row.id)}
            data-kind="image"
            aria-busy={imageGenerating ? true : undefined}
          >
            {imageGenerating ? (
              <span className="sidebar-item-spinner" aria-hidden>
                <Loader2 size={12} className="voice-spinner" />
              </span>
            ) : (
              <SidebarKindGlyph kind="image" />
            )}
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
      const titleGenerating =
        (titleGenInFlight[c.id] ?? 0) > 0 || !!titleAwaitingIds[c.id];
      const titlePending = isConversationTitlePending(c.title, titleGenerating);
      const chatStreaming =
        view === "chat" && conversationId === c.id && activeChatProcessing;
      const iconKind = conversationSidebarIconKind(c);
      return (
        <li
          key={c.id}
          className={[
            "sidebar-item",
            isActive ? "active" : "",
            arrivedLibraryIds[c.id] ? "sidebar-item--arrived" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-testid="sidebar-conversation"
          data-conversation-id={c.id}
          data-kind={iconKind}
          onClick={() => {
            onConversationSelect(c.id);
            onViewChange("chat");
          }}
          aria-busy={titlePending || chatStreaming ? true : undefined}
        >
          {chatStreaming ? (
            <span className="sidebar-item-spinner" aria-hidden>
              <Loader2 size={12} className="voice-spinner" />
            </span>
          ) : (
            <SidebarKindGlyph kind={iconKind} />
          )}
          {titlePending ? (
            <Skeleton className="ui-skeleton--sidebar-title" label="Generating title" />
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
      processingImageIds,
      onConversationDelete,
      onConversationSelect,
      onImageDelete,
      onNoteDelete,
      onSelectImage,
      onSelectNote,
      onViewChange,
      titleGenInFlight,
      titleAwaitingIds,
      arrivedLibraryIds,
      view,
    ]
  );

  return (
    <div className="sidebar-dock">
      <aside className="sidebar" id="app-sidebar">
        {libraryRows.length > 0 ? (
          <div className="sidebar-list-header">
            {renderListMenu(
              libraryFilter === "all" ? "Harness" : filterLabel,
              `${filteredLibraryRows.length} item${filteredLibraryRows.length === 1 ? "" : "s"}`,
            )}
          </div>
        ) : null}
        <div
          className={[
            "sidebar-list-wrap",
            fadeTop ? "sidebar-list-wrap--fade-top" : "",
            fadeBottom ? "sidebar-list-wrap--fade-bottom" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <ul ref={sidebarListRef} className="sidebar-list" onScroll={onListScroll}>
            {showDevSection ? (
              <li className="sidebar-group">
                <span className="sidebar-group-label">Dev</span>
                <ul className="sidebar-group-items">
                  {renderDevItem("dev-chat", "Chat", "chat")}
                  {renderDevItem("dev-dictation", "Dictation", "dictation")}
                  {renderDevItem("dev-note", "Note", "note")}
                  {renderDevItem("dev-image", "Image", "image")}
                </ul>
              </li>
            ) : null}
            {sidebarGroups.length === 0 && libraryRows.length > 0 ? (
              <li className="sidebar-group">
                <p className="sidebar-list-empty" data-testid="sidebar-filter-empty">
                  No {filterLabel.toLowerCase()} yet
                </p>
              </li>
            ) : null}
            {sidebarGroups.map(({ key, label, weekday, items }: SidebarGroup) => (
              <li
                key={key}
                className={["sidebar-group", key === "recent" ? "sidebar-group--unlabeled" : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                {/* A flat "Recent" list needs no label under the list title. */}
                {key === "recent" ? null : (
                  <span className="sidebar-group-label">
                    {label}
                    {weekday ? <span className="sidebar-group-weekday">{weekday}</span> : null}
                  </span>
                )}
                <ul className="sidebar-group-items">
                  {items.map((row) => renderLibraryItem(row))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
        {showUpdateButton ? (
          <div className="sidebar-footer">
            <button
              type="button"
              className={
                updateStatus.status === "error"
                  ? "btn sidebar-footer__update-btn sidebar-footer__update-btn--error"
                  : "btn sidebar-footer__update-btn"
              }
              data-testid="sidebar-update"
              onClick={onUpdateClick}
              disabled={updateButtonDisabled}
              title={
                appVersion ? `${updateButtonTitle(updateStatus)} (now v${appVersion})` : updateButtonTitle(updateStatus)
              }
            >
              {updateLabel}
            </button>
          </div>
        ) : null}
      </aside>
    </div>
  );
}
