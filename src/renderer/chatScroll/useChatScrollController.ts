/**
 * Chat scroll contract:
 * - Park the new turn near the top of the scrollport once when the user sends a message, so the
 *   streaming reply owns the readable area between the turn and the composer dock.
 * - No auto-follow during streaming — the thread stays where it was parked until the user scrolls
 *   or explicitly jumps to the bottom.
 * - User scroll of the thread is never overridden programmatically except explicit scrollToBottom.
 */
import { snapToGrid } from "../../shared/grid";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, RefObject, UIEvent } from "react";
import {
  didTurnJustStart,
  scrollToLiveEdge,
  trailingSpacerForOffset,
  turnParkPlan,
} from "./chatScrollLogic";

/** Gap left above the parked turn. */
const TURN_HEADROOM_PX = 16;
const TURN_SPACER_VAR = "--chat-turn-spacer";

function readTurnSpacer(scroll: HTMLDivElement): number {
  const px = parseFloat(scroll.style.getPropertyValue(TURN_SPACER_VAR));
  return Number.isFinite(px) ? px : 0;
}

function writeTurnSpacer(scroll: HTMLDivElement, px: number): void {
  scroll.style.setProperty(TURN_SPACER_VAR, `${Math.max(0, Math.round(px))}px`);
}

/** Top of the newest user message in scroll-content coordinates. */
function turnAnchorTop(scroll: HTMLDivElement): number | null {
  const anchors = scroll.querySelectorAll<HTMLElement>('[data-message-role="user"]');
  const anchor = anchors[anchors.length - 1];
  if (!anchor) return null;
  return anchor.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop;
}

function parkTurn(scroll: HTMLDivElement): void {
  writeTurnSpacer(scroll, 0);
  const anchorTop = turnAnchorTop(scroll);
  if (anchorTop == null) {
    scrollToLiveEdge(scroll);
    return;
  }
  const plan = turnParkPlan({
    anchorTop,
    headroom: TURN_HEADROOM_PX,
    contentHeight: scroll.scrollHeight,
    clientHeight: scroll.clientHeight,
  });
  writeTurnSpacer(scroll, plan.spacer);
  // Reading scrollHeight flushes the spacer into layout before the offset is applied.
  scroll.scrollTop = Math.min(plan.scrollTop, scroll.scrollHeight - scroll.clientHeight);
}

/** Turn end: give back the parking space the thread no longer needs. */
function trimTurnSpacer(scroll: HTMLDivElement): void {
  const spacer = readTurnSpacer(scroll);
  if (spacer <= 0) return;
  const next = trailingSpacerForOffset({
    scrollTop: scroll.scrollTop,
    contentHeight: scroll.scrollHeight - spacer,
    clientHeight: scroll.clientHeight,
  });
  if (next < spacer) writeTurnSpacer(scroll, next);
}

export function useChatScrollController(args: {
  scrollRef: RefObject<HTMLDivElement | null>;
  chatPaneRef: RefObject<HTMLDivElement | null>;
  composerDockRef: RefObject<HTMLDivElement | null>;
  /** False when single-message centered landing disables follow behavior. */
  scrollEnabled: boolean;
  sending: boolean;
}) {
  const prevSendingRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  const runProgrammaticScroll = useCallback(
    (fn: () => void) => {
      programmaticScrollRef.current = true;
      fn();
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
        const scroll = args.scrollRef.current;
        if (scroll) lastScrollTopRef.current = scroll.scrollTop;
      });
    },
    [args.scrollRef]
  );

  /** Turn start: park once. Stream growth does not re-pin. */
  useLayoutEffect(() => {
    const scroll = args.scrollRef.current;
    const justStarted = didTurnJustStart(prevSendingRef.current, args.sending);
    const justEnded = prevSendingRef.current && !args.sending;
    prevSendingRef.current = args.sending;
    if (!scroll || !args.scrollEnabled) return;
    if (justStarted) {
      runProgrammaticScroll(() => parkTurn(scroll));
      return;
    }
    if (justEnded) trimTurnSpacer(scroll);
  }, [args.sending, args.scrollEnabled, args.scrollRef, runProgrammaticScroll]);

  /** Sync composer dock height into scroll inset CSS vars. */
  useLayoutEffect(() => {
    const pane = args.chatPaneRef.current;
    const dock = args.composerDockRef.current;
    const scroll = args.scrollRef.current;
    if (!pane || !dock || !scroll) return;

    const sync = () => {
      const h = Math.ceil(dock.getBoundingClientRect().height);
      const snapped = snapToGrid(h);
      pane.style.setProperty("--chat-composer-dock-height", `${snapped}px`);
      scroll.style.setProperty("--chat-composer-dock-height", `${snapped}px`);
    };

    sync();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(sync);
      ro.observe(dock);
    }
    window.addEventListener("resize", sync);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [args.chatPaneRef, args.composerDockRef, args.scrollRef]);

  const onScroll = useCallback(
    (_e: UIEvent<HTMLDivElement>) => {
      const el = args.scrollRef.current;
      if (!el) return;
      if (programmaticScrollRef.current) {
        lastScrollTopRef.current = el.scrollTop;
        return;
      }
      lastScrollTopRef.current = el.scrollTop;
    },
    [args.scrollRef]
  );

  const onKeyDown = useCallback((_e: KeyboardEvent<HTMLDivElement>) => {}, []);

  const scrollToBottom = useCallback(() => {
    const scroll = args.scrollRef.current;
    if (!scroll) return;
    runProgrammaticScroll(() => scrollToLiveEdge(scroll));
  }, [args.scrollRef, runProgrammaticScroll]);

  /** Single-message centered landing: reset scroll. */
  useLayoutEffect(() => {
    if (args.scrollEnabled) return;
    const scroll = args.scrollRef.current;
    if (scroll) {
      writeTurnSpacer(scroll, 0);
      scroll.scrollTop = 0;
      lastScrollTopRef.current = 0;
    }
  }, [args.scrollEnabled, args.scrollRef]);

  return {
    onScroll,
    onKeyDown,
    scrollToBottom,
  };
}
