import { LAYOUT_DEBUG_TARGETS } from "./layoutDebugTargets";
import type { LayoutDebugBox } from "./measureLayoutBoxes";

function formatSize(boxes: LayoutDebugBox[]): string {
  if (boxes.length === 0) return "—";
  if (boxes.length === 1) return `${boxes[0].width}×${boxes[0].height}`;
  return `${boxes.length}`;
}

export function LayoutDebugPanel({
  showBoxes,
  hiddenTargetIds,
  boxes,
  onShowBoxesChange,
  onToggleTarget,
  onClose,
}: {
  showBoxes: boolean;
  hiddenTargetIds: ReadonlySet<string>;
  boxes: LayoutDebugBox[];
  onShowBoxesChange: (next: boolean) => void;
  onToggleTarget: (id: string) => void;
  onClose: () => void;
}) {
  const boxesById = new Map<string, LayoutDebugBox[]>();
  for (const box of boxes) {
    const list = boxesById.get(box.id) ?? [];
    list.push(box);
    boxesById.set(box.id, list);
  }

  return (
    <aside className="layout-debug-root layout-debug-panel" aria-label="Layout debug">
      <header className="layout-debug-panel__header">
        <h2 className="layout-debug-panel__title">Layout</h2>
        <button
          type="button"
          className="layout-debug-panel__close"
          onClick={onClose}
          aria-label="Hide layout debug"
        >
          Hide
        </button>
      </header>

      <label className="layout-debug-toggle">
        <input
          type="checkbox"
          checked={showBoxes}
          onChange={(event) => onShowBoxesChange(event.target.checked)}
          data-testid="layout-debug-show-boxes"
        />
        <span>Show boxes</span>
      </label>

      <ul className="layout-debug-list">
        {LAYOUT_DEBUG_TARGETS.map((target) => {
          const measured = boxesById.get(target.id) ?? [];
          const enabled = !hiddenTargetIds.has(target.id);
          return (
            <li key={target.id} className="layout-debug-list__item">
              <label className="layout-debug-list__row">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => onToggleTarget(target.id)}
                  aria-label={`Show ${target.label}`}
                />
                <span
                  className="layout-debug-swatch"
                  style={{ background: target.color }}
                  aria-hidden
                />
                <span className="layout-debug-list__label">{target.label}</span>
                <span className="layout-debug-list__size">
                  {showBoxes && enabled ? formatSize(measured) : ""}
                </span>
              </label>
              {showBoxes && enabled && measured.length > 1
                ? measured.map((box) => (
                    <p key={`${box.id}:${box.instance}`} className="layout-debug-list__instance">
                      {box.instance + 1} · {box.width}×{box.height}
                    </p>
                  ))
                : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
