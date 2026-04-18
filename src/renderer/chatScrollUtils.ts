export const USER_MESSAGE_TOP_OFFSET_PX = 24;

/** Dev-only structured logs for scroll alignment debugging (prefix matches ChatSurface `scrollDebugPrefix`). */
export function devLogChatScroll(
  scope: string,
  event: string,
  details: Record<string, unknown> = {}
): void {
  if (!import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.log(`[${scope}]`, event, details);
}

export function chatAreaMetrics(el: HTMLDivElement | null): Record<string, number | null> {
  if (!el) {
    return { currentScrollTop: null, scrollHeight: null, clientHeight: null };
  }
  return {
    currentScrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  };
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
