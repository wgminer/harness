/**
 * Chat scroll contract:
 * - Park the new turn near the top of the scrollport once when the user sends a message, so the
 *   streaming reply owns the readable area between the turn and the composer dock.
 * - No auto-follow during streaming — the thread stays where it was parked until the user scrolls
 *   or explicitly jumps to the bottom.
 * - User scroll of the thread is never overridden programmatically except explicit scrollToBottom
 *   and a one-shot live-edge land when an existing thread is opened.
 * - Dock-height changes only shift scrollTop when the reader is already at the live edge.
 */
import { snapToGrid } from "../../../shared/grid";
import { useCallback, useLayoutEffect, useRef } from "react";
import type { KeyboardEvent, RefObject, UIEvent } from "react";
import {
  didTurnJustStart,
  isNearLiveEdge,
  parkContentHeight,
  scrollToLiveEdge,
  scrollTopDeltaForPaddingChange,
  shouldLandOpenedThread,
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

function readPaddingBottom(el: HTMLElement): number {
  const px = parseFloat(getComputedStyle(el).paddingBottom);
  return Number.isFinite(px) ? px : 0;
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
  const wait = scroll.querySelector<HTMLElement>(".chat-stream-block--wait");
  const waitHeight = wait?.getBoundingClientRect().height ?? 0;
  const plan = turnParkPlan({
    anchorTop,
    headroom: TURN_HEADROOM_PX,
    contentHeight: parkContentHeight(scroll.scrollHeight, waitHeight),
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
  /** Conversation id — landing the live edge once when history is ready. */
  threadKey?: string;
  /** Bumps when transcript content is replaced (history load). */
  transcriptRevision?: number;
}) {
  const prevSendingRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const landedThreadRef = useRef<string | null>(null);

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

    let prevPadding = readPaddingBottom(scroll);

    const sync = () => {
      const h = Math.ceil(dock.getBoundingClientRect().height);
      const snapped = snapToGrid(h);
      const wasNearEdge = isNearLiveEdge(scroll);
      pane.style.setProperty("--chat-composer-dock-height", `${snapped}px`);
      scroll.style.setProperty("--chat-composer-dock-height", `${snapped}px`);
      const nextPadding = readPaddingBottom(scroll);
      const delta = scrollTopDeltaForPaddingChange(prevPadding, nextPadding);
      prevPadding = nextPadding;
      if (!args.scrollEnabled || delta === 0 || !wasNearEdge) return;
      scroll.scrollTop = Math.max(0, scroll.scrollTop + delta);
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
  }, [args.chatPaneRef, args.composerDockRef, args.scrollRef, args.scrollEnabled]);

  /** Opened thread: once history overflows, sit on the live edge (latest Q&A question). */
  useLayoutEffect(() => {
    if (!args.scrollEnabled) {
      landedThreadRef.current = null;
      return;
    }
    const scroll = args.scrollRef.current;
    const threadKey = args.threadKey ?? "";
    const action = shouldLandOpenedThread({
      threadKey,
      landedKey: landedThreadRef.current,
      scrollEnabled: args.scrollEnabled,
      sending: args.sending,
      hasOverflow: !!scroll && scroll.scrollHeight > scroll.clientHeight + 1,
    });
    if (action === "skip") return;
    landedThreadRef.current = threadKey;
    if (action === "land" && scroll) {
      runProgrammaticScroll(() => scrollToLiveEdge(scroll));
    }
  }, [
    args.scrollEnabled,
    args.sending,
    args.scrollRef,
    args.threadKey,
    args.transcriptRevision,
    runProgrammaticScroll,
  ]);

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
