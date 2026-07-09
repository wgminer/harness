/**
 * Chat scroll contract:
 * - pinned: auto-follow transcript growth (streaming, post-stream layout shifts)
 * - free: never programmatically scroll except explicit scrollToTop / scrollToBottom
 * - mode is stored in a ref so wheel/touch unlock is synchronous (no chunk-vs-setState race)
 * - userTookOver: once the user scrolls during a turn, auto-follow stays off until they
 *   return to the live edge or a new turn starts
 */
import { snapToGrid } from "../../shared/grid";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, RefObject, UIEvent } from "react";
import { SCROLL_TOP_THRESHOLD } from "../chatHelpers";
import {
  didTurnJustStart,
  isNearLiveEdge,
  scrollToLiveEdge,
  scrollTopDeltaForPaddingChange,
  shouldFollowTranscriptResize,
  shouldRepinFromUserScroll,
  shouldUnlockFromScrollDelta,
} from "./chatScrollLogic";
import type { ScrollMode } from "./chatScrollTypes";

export function useChatScrollController(args: {
  scrollRef: RefObject<HTMLDivElement | null>;
  transcriptRef: RefObject<HTMLElement | null>;
  chatPaneRef: RefObject<HTMLDivElement | null>;
  composerDockRef: RefObject<HTMLDivElement | null>;
  /** False when single-message centering mode disables follow behavior. */
  scrollEnabled: boolean;
  sending: boolean;
}) {
  const modeRef = useRef<ScrollMode>("pinned");
  const userTookOverRef = useRef(false);
  const prevSendingRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);
  const [hasScrolled, setHasScrolled] = useState(false);

  const markUserTookOver = useCallback(() => {
    userTookOverRef.current = true;
    modeRef.current = "free";
  }, []);

  const clearUserTakeover = useCallback(() => {
    userTookOverRef.current = false;
    modeRef.current = "pinned";
  }, []);

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

  const followLiveEdgeIfPinned = useCallback(() => {
    if (!shouldFollowTranscriptResize(modeRef.current, userTookOverRef.current)) return;
    const scroll = args.scrollRef.current;
    if (!scroll) return;
    runProgrammaticScroll(() => scrollToLiveEdge(scroll));
  }, [args.scrollRef, runProgrammaticScroll]);

  /** Turn start: pin and snap once. Stream end does not re-pin. */
  useLayoutEffect(() => {
    if (!args.scrollEnabled) return;
    const scroll = args.scrollRef.current;
    const justStarted = didTurnJustStart(prevSendingRef.current, args.sending);
    prevSendingRef.current = args.sending;
    if (!justStarted || !scroll) return;
    clearUserTakeover();
    runProgrammaticScroll(() => scrollToLiveEdge(scroll));
  }, [args.sending, args.scrollEnabled, args.scrollRef, clearUserTakeover, runProgrammaticScroll]);

  /** Follow transcript height changes while pinned (streaming tokens, markdown reflow). */
  useLayoutEffect(() => {
    if (!args.scrollEnabled) return;
    const transcript = args.transcriptRef.current;
    if (!transcript || typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver(() => {
      followLiveEdgeIfPinned();
    });
    ro.observe(transcript);
    return () => ro.disconnect();
  }, [args.scrollEnabled, args.transcriptRef, followLiveEdgeIfPinned]);

  const readScrollInset = useCallback((scroll: HTMLDivElement) => {
    const px = parseFloat(getComputedStyle(scroll).paddingBottom);
    return snapToGrid(Math.ceil(Number.isFinite(px) ? px : 0));
  }, []);

  /** Sync composer dock height; compensate scrollTop when pinned and padding changes. */
  useLayoutEffect(() => {
    const pane = args.chatPaneRef.current;
    const dock = args.composerDockRef.current;
    const scroll = args.scrollRef.current;
    if (!pane || !dock || !scroll) return;

    const sync = () => {
      const h = Math.ceil(dock.getBoundingClientRect().height);
      const snapped = snapToGrid(h);
      const prevInset = readScrollInset(scroll);
      pane.style.setProperty("--chat-composer-dock-height", `${snapped}px`);
      scroll.style.setProperty("--chat-composer-dock-height", `${snapped}px`);

      const nextInset = readScrollInset(scroll);
      if (
        shouldFollowTranscriptResize(modeRef.current, userTookOverRef.current) &&
        nextInset !== prevInset &&
        isNearLiveEdge(scroll)
      ) {
        const delta = scrollTopDeltaForPaddingChange(prevInset, nextInset);
        runProgrammaticScroll(() => {
          scroll.scrollTop += delta;
        });
      }
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
  }, [args.chatPaneRef, args.composerDockRef, args.scrollRef, readScrollInset, runProgrammaticScroll]);

  /**
   * Capture-phase native listeners run before layout-driven ResizeObserver callbacks,
   * so a wheel/touch during streaming unlocks before the next auto-scroll can fire.
   */
  useEffect(() => {
    if (!args.scrollEnabled) return;
    const el = args.scrollRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY !== 0 || e.deltaX !== 0) markUserTookOver();
    };
    const onTouchStart = () => {
      markUserTookOver();
    };

    el.addEventListener("wheel", onWheel, { capture: true, passive: true });
    el.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel, { capture: true });
      el.removeEventListener("touchstart", onTouchStart, { capture: true });
    };
  }, [args.scrollEnabled, args.scrollRef, markUserTookOver]);

  const onScroll = useCallback(
    (_e: UIEvent<HTMLDivElement>) => {
      const el = args.scrollRef.current;
      if (!el) return;
      setHasScrolled(el.scrollTop > SCROLL_TOP_THRESHOLD);

      if (programmaticScrollRef.current) {
        lastScrollTopRef.current = el.scrollTop;
        return;
      }

      const prevTop = lastScrollTopRef.current;
      const nextTop = el.scrollTop;

      if (shouldUnlockFromScrollDelta(prevTop, nextTop)) {
        markUserTookOver();
      } else if (
        shouldRepinFromUserScroll({
          mode: modeRef.current,
          prevScrollTop: prevTop,
          nextScrollTop: nextTop,
          nearLiveEdge: isNearLiveEdge(el),
        }) === "pinned"
      ) {
        clearUserTakeover();
      }
      lastScrollTopRef.current = nextTop;
    },
    [args.scrollRef, clearUserTakeover, markUserTookOver]
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "PageUp" || e.key === "Home" || e.key === "ArrowUp") {
        markUserTookOver();
      }
    },
    [markUserTookOver]
  );

  const scrollToTop = useCallback(() => {
    args.scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    markUserTookOver();
  }, [args.scrollRef, markUserTookOver]);

  const scrollToBottom = useCallback(() => {
    const scroll = args.scrollRef.current;
    if (!scroll) return;
    clearUserTakeover();
    runProgrammaticScroll(() => scrollToLiveEdge(scroll));
  }, [args.scrollRef, clearUserTakeover, runProgrammaticScroll]);

  /** Single-message centering: reset scroll and disable follow. */
  useLayoutEffect(() => {
    if (args.scrollEnabled) return;
    const scroll = args.scrollRef.current;
    if (scroll) {
      scroll.scrollTop = 0;
      lastScrollTopRef.current = 0;
    }
  }, [args.scrollEnabled, args.scrollRef]);

  return {
    hasScrolled,
    onScroll,
    onKeyDown,
    scrollToTop,
    scrollToBottom,
  };
}
