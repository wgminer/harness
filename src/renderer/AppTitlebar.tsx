import { useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { CheckLine, PanelLeft, Search, Settings2 as SettingsIcon } from "lucide-react";
import { SETTINGS_PAGE_TITLE } from "../shared/settingsPage";
import type { View } from "./sidebarUtils";

type AppTitlebarProps = {
  libraryOpen: boolean;
  onToggleLibrary: () => void;
  view: View;
  onViewChange: (v: View) => void;
  title: string;
};

export function AppTitlebar({
  libraryOpen,
  onToggleLibrary,
  view,
  onViewChange,
  title,
}: AppTitlebarProps) {
  const onTitlebarMouseDown = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;

    void (async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        await getCurrentWebviewWindow().startDragging();
      } catch {
        // Storybook / browser — no-op.
      }
    })();
  }, []);

  return (
    <header
      className="app-titlebar"
      data-tauri-drag-region
      onMouseDown={onTitlebarMouseDown}
    >
      <button
        type="button"
        className="app-titlebar__sidebar-toggle"
        data-tauri-drag-region={false}
        data-testid="library-toggle"
        aria-label={libraryOpen ? "Hide sidebar" : "Show sidebar"}
        aria-pressed={libraryOpen}
        aria-controls="app-sidebar"
        title={libraryOpen ? "Hide sidebar" : "Show sidebar"}
        onClick={onToggleLibrary}
      >
        <PanelLeft size={16} strokeWidth={1.75} aria-hidden />
      </button>
      <div className="app-titlebar__title" data-testid="titlebar-title" title={title}>
        {title}
      </div>
      <div className="app-titlebar__actions">
        <button
          type="button"
          className="app-titlebar__action"
          data-tauri-drag-region={false}
          data-testid="sidebar-search"
          aria-label="Search"
          aria-pressed={view === "search"}
          title="Search"
          onClick={() => onViewChange("search")}
        >
          <Search size={16} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="app-titlebar__action"
          data-tauri-drag-region={false}
          data-testid="library-tasks"
          aria-label="Tasks"
          aria-pressed={view === "tasks"}
          title="Tasks"
          onClick={() => onViewChange("tasks")}
        >
          <CheckLine size={16} strokeWidth={1.75} aria-hidden />
        </button>
        <button
          type="button"
          className="app-titlebar__action"
          data-tauri-drag-region={false}
          data-testid="library-settings"
          aria-label={SETTINGS_PAGE_TITLE}
          aria-pressed={view === "settings"}
          title={SETTINGS_PAGE_TITLE}
          onClick={() => onViewChange("settings")}
        >
          <SettingsIcon size={16} strokeWidth={1.75} aria-hidden />
        </button>
      </div>
    </header>
  );
}
