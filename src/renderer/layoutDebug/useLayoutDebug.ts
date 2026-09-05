import { useCallback, useEffect, useMemo, useState } from "react";
import { LAYOUT_DEBUG_TARGETS } from "./layoutDebugTargets";
import {
  readLayoutDebugPrefs,
  writeLayoutDebugPrefs,
  type LayoutDebugPrefs,
} from "./layoutDebugStorage";
import { measureLayoutBoxes, queryLayoutElements, type LayoutDebugBox } from "./measureLayoutBoxes";

export function useLayoutDebug(active: boolean) {
  const [prefs, setPrefs] = useState<LayoutDebugPrefs>(readLayoutDebugPrefs);
  const [boxes, setBoxes] = useState<LayoutDebugBox[]>([]);

  useEffect(() => {
    writeLayoutDebugPrefs(prefs);
  }, [prefs]);

  const hiddenTargetIds = useMemo(() => new Set(prefs.hiddenTargetIds), [prefs.hiddenTargetIds]);

  const refresh = useCallback(() => {
    if (!active || !prefs.showBoxes) {
      setBoxes([]);
      return;
    }
    setBoxes(measureLayoutBoxes(LAYOUT_DEBUG_TARGETS, queryLayoutElements, hiddenTargetIds));
  }, [active, hiddenTargetIds, prefs.showBoxes]);

  useEffect(() => {
    refresh();
    if (!active || !prefs.showBoxes) return;

    let frame = 0;
    const onScrollOrResize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(refresh);
    };

    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(onScrollOrResize);
      observer.observe(document.documentElement);
      const host = document.querySelector(".main-chat-host");
      if (host) observer.observe(host);
    }

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
      observer?.disconnect();
    };
  }, [active, prefs.showBoxes, refresh]);

  const setPanelOpen = useCallback((panelOpen: boolean) => {
    setPrefs((prev) => ({ ...prev, panelOpen }));
  }, []);

  const setShowBoxes = useCallback((showBoxes: boolean) => {
    setPrefs((prev) => ({ ...prev, showBoxes }));
  }, []);

  const toggleTarget = useCallback((id: string) => {
    setPrefs((prev) => {
      const hidden = new Set(prev.hiddenTargetIds);
      if (hidden.has(id)) hidden.delete(id);
      else hidden.add(id);
      return { ...prev, hiddenTargetIds: [...hidden] };
    });
  }, []);

  return {
    panelOpen: prefs.panelOpen,
    showBoxes: prefs.showBoxes,
    hiddenTargetIds,
    boxes,
    setPanelOpen,
    setShowBoxes,
    toggleTarget,
  };
}
