import { useLayoutEffect, useEffect, useRef, useState, type RefObject } from "react";

export const USER_MESSAGE_TOP_OFFSET_PX = 24;

/** Extra slack when deciding if the viewport is still "pinned" near the bottom (matches SCROLL_TOP_THRESHOLD order of magnitude). */
export const PINNED_NEAR_BOTTOM_TOLERANCE_PX = 24;

/**
 * Initial tail padding after send: composer chrome height + scroll viewport height (`chat-scroll` client height).
 * Never use `scrollHeight` here — it scales with thread length and breaks the model.
 */
export function seedTailPaddingPx(composerHeightPx: number, chatScrollViewportHeightPx: number): number {
  const raw = Math.round(composerHeightPx + chatScrollViewportHeightPx);
  return Math.min(Math.max(raw, 120), 6000);
}

/** Last streaming assistant column in the message list (inside `.chat-area-inner`). */
export function lastAssistantBlock(inner: HTMLElement): HTMLElement | null {
  const blocks = inner.querySelectorAll(".message-block.assistant");
  const last = blocks[blocks.length - 1];
  return last instanceof HTMLElement ? last : null;
}

/**
 * Trim tail padding as the assistant reply grows: subtract measured assistant height growth from the seed pad.
 * Does not use full inner scroll height (avoids coupling to entire conversation height).
 */
export function trimTailPaddingPx(args: {
  seedPadPx: number;
  assistantBaselinePx: number;
  assistantCurrentHeightPx: number;
}): number {
  const growth = Math.max(0, args.assistantCurrentHeightPx - args.assistantBaselinePx);
  return Math.max(0, Math.round(args.seedPadPx - growth));
}

export function alignLatestUserMessageToTop(chatArea: HTMLDivElement): {
  aligned: boolean;
  skippedReason?: "first-user-message";
  targetTop?: number;
  userTopDelta?: number;
} {
  const userMessageNodes = Array.from(
    chatArea.querySelectorAll('[data-message-role="user"]')
  ) as HTMLElement[];
  if (userMessageNodes.length <= 1) {
    return { aligned: false, skippedReason: "first-user-message" };
  }
  const userMessageEl = userMessageNodes[userMessageNodes.length - 1];
  const alignmentAnchor = userMessageEl.querySelector(".content") as HTMLElement | null;
  const targetEl = alignmentAnchor ?? userMessageEl;
  const chatAreaRect = chatArea.getBoundingClientRect();
  const userMessageRect = targetEl.getBoundingClientRect();
  const userTopDelta = userMessageRect.top - chatAreaRect.top;
  const targetTop = Math.max(0, chatArea.scrollTop + userTopDelta - USER_MESSAGE_TOP_OFFSET_PX);
  chatArea.scrollTo({ top: targetTop, behavior: "auto" });
  return { aligned: true, targetTop, userTopDelta };
}

export interface UseChatScrollOpts {
  chatAreaRef: RefObject<HTMLDivElement | null>;
  innerRef: RefObject<HTMLDivElement | null>;
  composerRef: RefObject<HTMLDivElement | null>;
  /** Monotonic send counter; bumps when the user sends (or polish) so we seed slack + align. */
  sendTick: number;
  /** Model streaming / waiting on reply. When false, slack eases to 0 via CSS (see .chat-area-inner transition). */
  sending: boolean;
}

export function useChatScroll({
  chatAreaRef,
  innerRef,
  composerRef,
  sendTick,
  sending,
}: UseChatScrollOpts): { slackPx: number } {
  const [slackPx, setSlackPx] = useState(0);
  const slackPxRef = useRef(0);
  slackPxRef.current = slackPx;

  const seedPadPxRef = useRef(0);
  const assistantBaselinePxRef = useRef(0);
  const lastHandledSendTickRef = useRef(0);

  /** When the assistant turn ends, release residual slack smoothly (padding transition). */
  const prevSendingRef = useRef(sending);
  useLayoutEffect(() => {
    if (prevSendingRef.current && !sending) {
      slackPxRef.current = 0;
      setSlackPx(0);
    }
    prevSendingRef.current = sending;
  }, [sending]);

  useLayoutEffect(() => {
    if (sendTick === 0) {
      lastHandledSendTickRef.current = 0;
      return;
    }
    if (sendTick === lastHandledSendTickRef.current) return;

    const chatArea = chatAreaRef.current;
    const inner = innerRef.current;
    if (!chatArea || !inner) return;

    lastHandledSendTickRef.current = sendTick;

    const composerEl = composerRef.current;
    const composerH = composerEl ? Math.ceil(composerEl.getBoundingClientRect().height) : 0;
    const viewportH = chatArea.clientHeight;
    const seedPad = seedTailPaddingPx(composerH, viewportH);

    seedPadPxRef.current = seedPad;

    // Apply padding on the real node now so `alignLatestUserMessageToTop` measures the post-slack layout.
    // Do not use `flushSync` here — it is not allowed during the layout effect and triggers a React warning.
    inner.style.paddingBottom = `${seedPad}px`;
    setSlackPx(seedPad);
    slackPxRef.current = seedPad;

    const scrollTopBefore = chatArea.scrollTop;
    const result = alignLatestUserMessageToTop(chatArea);

    const assistant = lastAssistantBlock(inner);
    const assistantBaselinePx = assistant?.offsetHeight ?? 0;
    assistantBaselinePxRef.current = assistantBaselinePx;

    if (import.meta.env.DEV) {
      const maxScrollTop = Math.max(0, chatArea.scrollHeight - chatArea.clientHeight);
      // eslint-disable-next-line no-console
      console.log("[chat-scroll] send scroll math", {
        sendTick,
        composerH,
        viewportH_chatClientHeight: viewportH,
        seedPaddingBottom: seedPad,
        align: {
          aligned: result.aligned,
          skippedReason: result.skippedReason,
          // targetScrollTop ≈ scrollTopBefore + userTopDelta − offsetPx (see alignLatestUserMessageToTop)
          userTopDelta: result.userTopDelta,
          targetScrollTop: result.targetTop,
          scrollTopBefore,
          scrollTopAfter: chatArea.scrollTop,
          offsetPx: USER_MESSAGE_TOP_OFFSET_PX,
        },
        assistantBaselinePx,
        chatScrollHeight: chatArea.scrollHeight,
        chatClientHeight: chatArea.clientHeight,
        maxScrollTop,
      });
    }
  }, [sendTick, chatAreaRef, innerRef, composerRef]);

  /** As the assistant block grows, burn down padding; skip trim when user scrolled up to read history. */
  useEffect(() => {
    if (slackPx <= 0) return;

    const inner = innerRef.current;
    const chatArea = chatAreaRef.current;
    if (!inner || !chatArea) return;

    const trim = () => {
      const chat = chatAreaRef.current;
      const inn = innerRef.current;
      if (!chat || !inn) return;

      const pad = slackPxRef.current;
      if (pad <= 0) return;

      const distanceFromBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
      if (distanceFromBottom > pad + PINNED_NEAR_BOTTOM_TOLERANCE_PX) return;

      const assistant = lastAssistantBlock(inn);
      const assistantH = assistant?.offsetHeight ?? 0;

      const next = trimTailPaddingPx({
        seedPadPx: seedPadPxRef.current,
        assistantBaselinePx: assistantBaselinePxRef.current,
        assistantCurrentHeightPx: assistantH,
      });
      if (next !== slackPxRef.current) {
        setSlackPx(next);
        slackPxRef.current = next;
      }
    };

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => trim());
      ro.observe(inner);
    }
    window.addEventListener("resize", trim);
    trim();

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", trim);
    };
  }, [slackPx, chatAreaRef, innerRef]);

  return { slackPx };
}
