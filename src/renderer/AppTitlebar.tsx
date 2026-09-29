import { useCallback, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { Skeleton } from "./ui/Skeleton";

type AppTitlebarProps = {
  libraryOpen: boolean;
  onToggleLibrary: () => void;
  title: string;
  /** When true, the title is a pulsing bar instead of placeholder text. */
  titlePending?: boolean;
  /** Opens conversation details when the title is clicked (chat thread only). */
  onTitleClick?: () => void;
  /** Drawn over the sidebar's column while open; sits beside the toggle while closed. */
  sidebarActions?: ReactNode;
  /** Pinned to the far right of the titlebar, whether or not the sidebar is open. */
  trailingActions?: ReactNode;
};

export function AppTitlebar({
  libraryOpen,
  onToggleLibrary,
  title,
  titlePending = false,
  onTitleClick,
  sidebarActions,
  trailingActions,
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
      {sidebarActions}
      {trailingActions}
      {onTitleClick ? (
        <button
          type="button"
          className="app-titlebar__title app-titlebar__title--action"
          data-tauri-drag-region={false}
          data-testid="titlebar-title"
          title="Details"
          aria-busy={titlePending ? true : undefined}
          onClick={onTitleClick}
        >
          {titlePending ? (
            <Skeleton className="ui-skeleton--title" label="Generating title" />
          ) : (
            title
          )}
        </button>
      ) : (
        <div className="app-titlebar__title" data-testid="titlebar-title" title={title}>
          {title}
        </div>
      )}
    </header>
  );
}
