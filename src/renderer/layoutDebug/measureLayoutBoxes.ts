import {
  LAYOUT_DEBUG_EXCLUDE_SELECTOR,
  type LayoutDebugTarget,
} from "./layoutDebugTargets";

export type LayoutDebugBox = {
  id: string;
  instance: number;
  label: string;
  color: string;
  width: number;
  height: number;
  top: number;
  left: number;
};

export type LayoutRect = {
  width: number;
  height: number;
  top: number;
  left: number;
};

function isVisibleRect(rect: LayoutRect): boolean {
  return rect.width > 0 && rect.height > 0;
}

export function measureLayoutBoxes(
  targets: LayoutDebugTarget[],
  queryAll: (selector: string) => Array<{
    getBoundingClientRect: () => LayoutRect;
    closest: (selector: string) => unknown;
  }>,
  hiddenTargetIds: ReadonlySet<string> = new Set(),
): LayoutDebugBox[] {
  const boxes: LayoutDebugBox[] = [];
  for (const target of targets) {
    if (hiddenTargetIds.has(target.id)) continue;
    const matches = queryAll(target.selector).filter(
      (el) => !el.closest(LAYOUT_DEBUG_EXCLUDE_SELECTOR),
    );
    const picked = target.all ? matches : matches.slice(0, 1);
    picked.forEach((el, index) => {
      const rect = el.getBoundingClientRect();
      if (!isVisibleRect(rect)) return;
      boxes.push({
        id: target.id,
        instance: index,
        label: target.all && picked.length > 1 ? `${target.label} ${index + 1}` : target.label,
        color: target.color,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        top: Math.round(rect.top),
        left: Math.round(rect.left),
      });
    });
  }
  return boxes;
}

export function queryLayoutElements(selector: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(selector)];
}
