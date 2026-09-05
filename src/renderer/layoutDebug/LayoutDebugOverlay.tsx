import { createPortal } from "react-dom";
import type { LayoutDebugBox } from "./measureLayoutBoxes";

export function LayoutDebugOverlay({
  boxes,
  visible,
}: {
  boxes: LayoutDebugBox[];
  visible: boolean;
}) {
  if (!visible || boxes.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <div className="layout-debug-root layout-debug-overlay" aria-hidden="true">
      {boxes.map((box) => (
        <div
          key={`${box.id}:${box.instance}`}
          className="layout-debug-box"
          data-layout-debug-id={box.id}
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            ["--layout-debug-color" as string]: box.color,
          }}
        >
          <span className="layout-debug-box__label">
            {box.label} {box.width}×{box.height}
          </span>
        </div>
      ))}
    </div>,
    document.body,
  );
}
