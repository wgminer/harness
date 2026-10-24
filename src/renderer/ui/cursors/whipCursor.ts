/** Wind up, then swing through, then back to rest (ms per frame). */
const WHACK_FRAMES = [
  { pose: "windup", ms: 70 },
  { pose: "strike", ms: 110 },
] as const;

/** Swing the crop arrow on a primary press, only where the arrow is showing. */
export function initWhipCursor(): void {
  const root = document.documentElement;
  let timers: number[] = [];

  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.button !== 0 || event.pointerType !== "mouse") return;
      if (!(event.target instanceof Element)) return;
      if (!getComputedStyle(event.target).cursor.includes("/cursors/crop")) return;
      timers.forEach((id) => window.clearTimeout(id));
      timers = [];
      let at = 0;
      for (const { pose, ms } of WHACK_FRAMES) {
        timers.push(window.setTimeout(() => (root.dataset.whip = pose), at));
        at += ms;
      }
      timers.push(window.setTimeout(() => delete root.dataset.whip, at));
    },
    { capture: true, passive: true }
  );
}
