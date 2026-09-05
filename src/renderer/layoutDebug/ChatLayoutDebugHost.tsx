import type { ReactNode } from "react";
import { LayoutDebugOverlay } from "./LayoutDebugOverlay";
import { LayoutDebugPanel } from "./LayoutDebugPanel";
import { useLayoutDebug } from "./useLayoutDebug";
import "./layoutDebug.css";

export function ChatLayoutDebugHost({
  children,
  active,
}: {
  children: ReactNode;
  active: boolean;
}) {
  const debug = useLayoutDebug(active);

  return (
    <div className="layout-debug-shell">
      <div className="layout-debug-shell__chat">
        {children}
        {debug.panelOpen ? null : (
          <button
            type="button"
            className="layout-debug-tab"
            onClick={() => debug.setPanelOpen(true)}
          >
            Debug
          </button>
        )}
      </div>
      {debug.panelOpen ? (
        <LayoutDebugPanel
          showBoxes={debug.showBoxes}
          hiddenTargetIds={debug.hiddenTargetIds}
          boxes={debug.boxes}
          onShowBoxesChange={debug.setShowBoxes}
          onToggleTarget={debug.toggleTarget}
          onClose={() => debug.setPanelOpen(false)}
        />
      ) : null}
      <LayoutDebugOverlay boxes={debug.boxes} visible={active && debug.showBoxes} />
    </div>
  );
}
