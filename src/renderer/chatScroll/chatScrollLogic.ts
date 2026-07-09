import type { ScrollMode } from "./chatScrollTypes";
import { LIVE_EDGE_TOLERANCE_PX } from "./chatScrollTypes";

export { LIVE_EDGE_TOLERANCE_PX };

export function distanceFromLiveEdge(scrollEl: HTMLDivElement): number {
  return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
}

export function scrollToLiveEdge(scrollEl: HTMLDivElement): void {
  scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
}

export function isNearLiveEdge(
  scrollEl: HTMLDivElement,
  tolerance = LIVE_EDGE_TOLERANCE_PX
): boolean {
  return distanceFromLiveEdge(scrollEl) <= tolerance;
}

/** Rising edge of `sending` — snap and pin at turn start. */
export function didTurnJustStart(prevSending: boolean, sending: boolean): boolean {
  return !prevSending && sending;
}

export function shouldFollowTranscriptResize(mode: ScrollMode, userTookOver: boolean): boolean {
  return mode === "pinned" && !userTookOver;
}

/** User scrolled up (scrollbar, touch, etc.) — release the follow lock. */
export function shouldUnlockFromScrollDelta(prevScrollTop: number, nextScrollTop: number): boolean {
  return nextScrollTop < prevScrollTop - 1;
}

/** User deliberately scrolled down to the live edge — re-pin. Proximity alone is not enough. */
export function shouldRepinFromUserScroll(args: {
  mode: ScrollMode;
  prevScrollTop: number;
  nextScrollTop: number;
  nearLiveEdge: boolean;
}): ScrollMode {
  if (
    args.mode === "free" &&
    args.nearLiveEdge &&
    args.nextScrollTop > args.prevScrollTop + 1
  ) {
    return "pinned";
  }
  return args.mode;
}

/** When composer dock padding grows/shrinks, keep visible content stable while pinned. */
export function scrollTopDeltaForPaddingChange(prevPaddingPx: number, nextPaddingPx: number): number {
  return nextPaddingPx - prevPaddingPx;
}
