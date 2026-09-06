import { useEffect } from "react";
import {
  applyTimeOfDayBackground,
  DEFAULT_TIME_OF_DAY_PREVIEW,
  isTimeThemeActive,
  subscribeTimeOfDayPreview,
} from "../shared/timeOfDayBackground";

const TICK_MS = 15_000;

/** Keeps the world-clock shell tint in sync while the Time theme is on. */
export function useTimeOfDayBackground(): void {
  useEffect(() => {
    const tick = () => {
      if (isTimeThemeActive()) {
        applyTimeOfDayBackground(new Date(), undefined, undefined, DEFAULT_TIME_OF_DAY_PREVIEW);
      }
    };
    tick();
    const id = window.setInterval(tick, TICK_MS);
    const unsub = subscribeTimeOfDayPreview(tick);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      unsub();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
