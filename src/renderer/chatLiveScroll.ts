import { useLayoutEffect, useRef, type RefObject } from "react";

export const LIVE_EDGE_TOLERANCE_PX = 32;

export function distanceFromLiveEdge(scrollEl: HTMLDivElement): number {
  return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
}

export function scrollScrollContainerToLiveEdge(scrollEl: HTMLDivElement): void {
  scrollEl.scrollTop = Math.max(0, scrollEl.scrollHeight - scrollEl.clientHeight);
}

/** Gating helper for {@link useFollowChatLiveEdge}; exported so tests can exercise it directly. */
export function shouldScrollToLiveEdge(args: {
  justStartedTurn: boolean;
  followLiveEdge: boolean;
}): boolean {
  return args.justStartedTurn || args.followLiveEdge;
}

/**
 * Simple chat scrolling: jump to the latest content when a turn starts, then keep following
 * only while `followLiveEdge` stays true. The caller is expected to flip `followLiveEdge`
 * off as soon as the user scrolls away from the live edge, so the user can break the lock
 * mid-stream by scrolling up.
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

    if (shouldScrollToLiveEdge({ justStartedTurn, followLiveEdge: args.followLiveEdge })) {
      scrollScrollContainerToLiveEdge(scroll);
    }
  }, [args.followLiveEdge, args.sending, args.streamingContent, args.messageCount, args.scrollRef]);
}
