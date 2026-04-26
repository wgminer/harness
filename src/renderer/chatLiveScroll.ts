import { useLayoutEffect, useRef, type RefObject } from "react";

export const LIVE_EDGE_TOLERANCE_PX = 32;

export function distanceFromLiveEdge(scrollEl: HTMLDivElement): number {
  return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
}

export function scrollScrollContainerToLiveEdge(scrollEl: HTMLDivElement): void {
  scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
}

/**
 * Simple chat scrolling: jump to the latest content when a turn starts, then keep following
 * only while the user stays near the live edge.
 */
export function useFollowChatLiveEdge(args: {
  scrollRef: RefObject<HTMLDivElement | null>;
  followLiveEdge: boolean;
  sending: boolean;
  streamingContent: string;
  messageCount: number;
}): void {
  const prevSendingRef = useRef(false);

  useLayoutEffect(() => {
    const scroll = args.scrollRef.current;
    if (!scroll) return;

    const justStartedTurn = !prevSendingRef.current && args.sending;
    prevSendingRef.current = args.sending;

    if (justStartedTurn || args.followLiveEdge) {
      scrollScrollContainerToLiveEdge(scroll);
    }
  }, [args.followLiveEdge, args.sending, args.streamingContent, args.messageCount, args.scrollRef]);
}
