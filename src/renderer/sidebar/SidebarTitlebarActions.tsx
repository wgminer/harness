import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckLine,
  Circle,
  Image as ImageIcon,
  Plus,
  Settings2 as SettingsIcon,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import { SETTINGS_PAGE_TITLE } from "../../shared/settingsPage";
import { sidebarSyncStatusTooltip, type SyncStatus } from "../../shared/sync";
import { useDismissible } from "../hooks/useDismissible";
import type { View } from "./sidebarUtils";

interface SidebarTitlebarActionsProps {
  view: View;
  onViewChange: (v: View) => void;
  onNewChat: () => void;
  onNewNote: () => void;
  onNewImage: () => void;
}

/** New menu plus Tasks, drawn in the titlebar above the sidebar. */
export function SidebarTitlebarActions({
  view,
  onViewChange,
  onNewChat,
  onNewNote,
  onNewImage,
}: SidebarTitlebarActionsProps) {
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const newMenuRef = useRef<HTMLDivElement | null>(null);
  const modKey = navigator.platform.startsWith("Mac") ? "⌘" : "Ctrl+";

  useDismissible({
    open: newMenuOpen,
    onDismiss: () => setNewMenuOpen(false),
    refs: [newMenuRef],
    pointerEvent: "mousedown",
  });

  const items = [
    { label: "New chat", Icon: Circle, shortcut: `${modKey}N`, testId: "sidebar-new-chat", run: onNewChat },
    { label: "New note", Icon: StickyNote, shortcut: `⇧${modKey}N`, testId: "sidebar-new-note", run: onNewNote },
    { label: "New image", Icon: ImageIcon, shortcut: `⇧${modKey}I`, testId: "sidebar-new-image", run: onNewImage },
  ];

  const renderNavButton = (target: View, label: string, Icon: LucideIcon, testId: string) => (
    <button
      type="button"
      className={`app-titlebar__action${view === target ? " app-titlebar__action--active" : ""}`}
      onClick={() => onViewChange(target)}
      aria-label={label}
      aria-pressed={view === target}
      title={label}
      data-testid={testId}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
    </button>
  );

  return (
    <div className="app-titlebar__sidebar-actions" data-tauri-drag-region={false}>
      <div className="sidebar-new-menu-wrap" ref={newMenuRef}>
        <button
          type="button"
          className="app-titlebar__action"
          data-testid="sidebar-new-menu"
          aria-label="New"
          aria-haspopup="menu"
          aria-expanded={newMenuOpen}
          title="New"
          onClick={() => setNewMenuOpen((open) => !open)}
        >
          <Plus size={16} strokeWidth={1.75} aria-hidden />
        </button>
        {newMenuOpen ? (
          <div className="sidebar-new-menu" role="menu" aria-label="Create new">
            {items.map(({ label, Icon, shortcut, testId, run }) => (
              <button
                key={testId}
                type="button"
                className="sidebar-new-menu-item"
                role="menuitem"
                data-testid={testId}
                onClick={() => {
                  setNewMenuOpen(false);
                  run();
                }}
              >
                <span className="sidebar-new-menu-item__main">
                  <Icon size={16} className="sidebar-new-menu-item__icon" aria-hidden />
                  <span>{label}</span>
                </span>
                <span className="sidebar-new-menu-item__shortcut" aria-hidden>
                  {shortcut}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {renderNavButton("tasks", "Tasks", CheckLine, "library-tasks")}
    </div>
  );
}

interface TitlebarSettingsButtonProps {
  view: View;
  onViewChange: (v: View) => void;
  onOpenDataSettings: () => void;
}

/** Settings, pinned to the far right of the titlebar. Shows a dot when sync has an error. */
export function TitlebarSettingsButton({ view, onViewChange, onOpenDataSettings }: TitlebarSettingsButtonProps) {
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const syncHasError = Boolean(syncStatus?.lastError);

  const refreshSyncStatus = useCallback(() => {
    void window.harness.sync.getStatus().then(setSyncStatus);
  }, []);

  useEffect(() => {
    if (view === "settings") return;
    refreshSyncStatus();
  }, [view, refreshSyncStatus]);

  useEffect(() => window.harness.sync.onChanged(refreshSyncStatus), [refreshSyncStatus]);

  return (
    <div className="app-titlebar__trailing-actions" data-tauri-drag-region={false}>
      <button
        type="button"
        className={`app-titlebar__action${view === "settings" ? " app-titlebar__action--active" : ""}`}
        onClick={() => (syncHasError ? onOpenDataSettings() : onViewChange("settings"))}
        aria-label={SETTINGS_PAGE_TITLE}
        aria-pressed={view === "settings"}
        title={
          syncHasError
            ? sidebarSyncStatusTooltip({
                busy: false,
                configured: syncStatus?.configured ?? false,
                lastError: syncStatus?.lastError ?? null,
                lastSuccessAt: syncStatus?.lastSuccessAt ?? null,
              })
            : SETTINGS_PAGE_TITLE
        }
        data-testid="library-settings"
      >
        <SettingsIcon size={16} strokeWidth={1.75} aria-hidden />
        {syncHasError ? (
          <span className="app-titlebar__action-dot" data-testid="sidebar-sync" aria-label="Sync error" />
        ) : null}
      </button>
    </div>
  );
}
