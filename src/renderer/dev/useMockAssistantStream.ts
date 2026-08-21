import { useCallback, useEffect, useRef, useState } from "react";

/** Source: conv_1779493466922_szvx76w — turn 1 user message. */
export const DEV_CHAT_USER_1 =
  "An edge case I need you to track down: If you're on a page and focused on the app, but not in an area where the most recent chat is visible, the most recent chat does process the reply but doesn't show it. So that's a bug. And also, in general, I think we need a way to handle just hitting the hotkey when you're focused on the app but not in the chat itself.";

/** Source: conv_1779493466922_szvx76w — turn 1 assistant reply. */
export const DEV_CHAT_ASSISTANT_1 = `Yep. Two separate but related issues:

- visibility bug: the latest chat receives/processes the reply, but the UI doesn't reveal it if focus is elsewhere in the app
- hotkey behavior gap: global hotkey while the app is focused, but chat input is not, needs a defined routing rule

A clean way to frame it:

1. Expected behavior
2. Likely failure points
3. Recommended fix path
4. Edge cases to test

Expected behavior

When the app is focused and the user triggers the hotkey:

- If there is an active/latest chat target, route the reply there
- Reveal that chat/thread if needed
- Scroll to the newest message
- Move focus to the right input surface if the interaction expects continued typing
- If no valid chat target exists, fail loudly and predictably (toast, focus chat picker, or open last active chat)

For the bug you described specifically:

- processing the reply without surfacing it is almost certainly wrong
- if a reply is accepted into a thread, the UI should reconcile to that state immediately

Likely failure points

A few common causes:

- state updates the conversation store, but the visible pane is not subscribed to the latest-thread change
- the app knows "current page" and "latest chat" separately, and the hotkey handler writes to one while the renderer is still bound to another
- scroll-to-bottom or reveal logic only runs when the chat panel already has focus
- focus guard prevents navigation/reveal if the event originated outside the chat subtree
- there's a stale "active conversation id" vs "last used conversation id" mismatch

Recommended fix path

I'd treat this as an explicit routing problem, not just a scroll bug.

Define a single hotkey target resolver:

- if chat input is focused, use current chat
- else if app is focused and a chat session is active in memory, use that
- else open/focus the most recent eligible chat
- after routing, always reveal the target conversation and newest message

Concretely, the hotkey flow should be something like:

- resolveTargetConversation()
- append/process reply
- setActiveConversation(targetId)
- ensureChatPaneVisible()
- scrollMessageIntoView(lastMessageId)
- optionally focusComposer()

That ordering matters. If append happens without updating the visible target, you get exactly the bug you described.

Recommendation on the "app focused but not chat focused" behavior

I'd pick one of these and make it consistent:

Option A: route to active/latest chat and reveal it
- best default
- minimal surprise
- good for power users

Option B: route to active/latest chat but do not steal focus
- preserves user context better
- still needs a toast/banner like "Reply sent to Chat X"

Option C: if not in chat, first focus/reveal chat, second hotkey submits
- safer
- slower
- probably too much friction for a hotkey workflow

My recommendation: Option A.

If the user hits the hotkey inside the app, they're expressing intent to interact with chat. So the app should bring the relevant chat into view and make the result obvious.

Edge cases to test

- app focused on settings/page/sidebar, latest chat hidden
- split view with chat mounted but scrolled away from latest message
- no chat exists yet
- latest chat is archived/closed/invalid
- multiple workspaces/projects with separate recent chats
- modal open
- text field focused elsewhere in app
- chat is processing a previous reply already
- virtualized message list where newest item is not mounted yet
- route transition in progress when hotkey fires

Useful acceptance criteria

- Triggering the hotkey while app is focused always results in a visible, discoverable outcome
- No reply is ever appended to a conversation that is not revealed or otherwise clearly indicated
- Active conversation, visible conversation, and reply target remain consistent after hotkey handling
- If reveal fails, the user gets immediate feedback instead of silent success

If useful, I can turn this into:
- a tight bug report
- an implementation plan
- or a test matrix for QA/devs`;

/** Back-compat alias — dictation mock stream uses the first assistant reply. */
export const DEV_STREAM_FIXTURE = DEV_CHAT_ASSISTANT_1;

/** Source: conv_1779585939751_iy0p80s — turn 2 user message. */
export const DEV_CHAT_USER_2 =
  "After the first seven items in the list, make the next three fade out progressively to zero opacity. On hover, make them come back in one at a time with that More button as well.";

/** Source: conv_1779585939751_iy0p80s — turn 2 assistant reply. */
export const DEV_CHAT_ASSISTANT_2 = `Use a cutoff + staggered opacity.

If your list items are direct children, this is the simplest version:

\`\`\`css
/* Keep first 7 fully visible */
.list > *:nth-child(-n + 7) {
  opacity: 1;
}

/* Fade out items 8, 9, 10 */
.list > *:nth-child(8) {
  opacity: 0.66;
}

.list > *:nth-child(9) {
  opacity: 0.33;
}

.list > *:nth-child(10) {
  opacity: 0;
}

/* Hide anything after 10 */
.list > *:nth-child(n + 11) {
  display: none;
}

/* On hover, bring back 8, 9, 10 progressively */
.list:hover > *:nth-child(8) {
  opacity: 1;
  transition-delay: 0s;
}

.list:hover > *:nth-child(9) {
  opacity: 1;
  transition-delay: 0.08s;
}

.list:hover > *:nth-child(10) {
  opacity: 1;
  transition-delay: 0.16s;
}

/* Base transition */
.list > *:nth-child(n + 8):nth-child(-n + 10) {
  transition: opacity 180ms ease;
}
\`\`\`

If the "More" button is a sibling after the list items, include it in the hover reveal too:

\`\`\`css
.more-button {
  opacity: 0;
  pointer-events: none;
  transition: opacity 180ms ease 0.24s;
}

.list:hover + .more-button,
.list-wrap:hover .more-button {
  opacity: 1;
  pointer-events: auto;
}
\`\`\`

Recommended structure:

\`\`\`html
<div class="list-wrap">
  <div class="list">
    ...
  </div>
  <button class="more-button">More</button>
</div>
\`\`\`

If you want, I can turn this into the exact selector version for your current markup or Tailwind/CSS-in-JS version.`;

/** Source: conv_1774625769828_2ogtvr0 — "Dictation @ 11:36 AM" user turn (polish button idea). */
export const DEV_DICTATION_FIXTURE =
  "Okay, so you see how we have get reply um for dictations. I want to add some additional buttons like uh for like editing um like uh yeah just like I think I mean the main one is just be like uh pot like a uh basically a button that like runs a polish and clarify prompt. Um honestly and I would say like that button really should just be like a should just send a message into the chat um almost as a prompt. Um in addition to like the user's dictation, if that makes sense.";

export type MockStreamSpeed = "normal" | "fast";

const SPEED_CONFIG: Record<MockStreamSpeed, { chunkSize: number; intervalMs: number }> = {
  normal: { chunkSize: 3, intervalMs: 40 },
  fast: { chunkSize: 12, intervalMs: 16 },
};

export function advanceMockStreamIndex(index: number, chunkSize: number, total: number): number {
  return Math.min(total, index + chunkSize);
}

export function mockStreamContent(index: number, fixture: string): string {
  return fixture.slice(0, index);
}

export function isMockStreamComplete(index: number, total: number): boolean {
  return index >= total;
}

export function waitMs(ms: number, cancelled?: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    window.setTimeout(() => {
      if (cancelled?.()) {
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      resolve();
    }, ms);
  });
}

export function streamText(
  fixture: string,
  speed: MockStreamSpeed,
  onChunk: (content: string) => void,
  cancelled?: () => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const { chunkSize, intervalMs } = SPEED_CONFIG[speed];
    let index = 0;
    const timer = window.setInterval(() => {
      if (cancelled?.()) {
        window.clearInterval(timer);
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      index = advanceMockStreamIndex(index, chunkSize, fixture.length);
      onChunk(mockStreamContent(index, fixture));
      if (isMockStreamComplete(index, fixture.length)) {
        window.clearInterval(timer);
        resolve();
      }
    }, intervalMs);
  });
}

export function useMockAssistantStream(fixture: string, speed: MockStreamSpeed = "normal") {
  const [content, setContent] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setContent("");
    setIsStreaming(false);
  }, [clearTimer]);

  const start = useCallback(() => {
    clearTimer();
    setContent("");
    setIsStreaming(true);
    const { chunkSize, intervalMs } = SPEED_CONFIG[speed];
    let index = 0;
    timerRef.current = window.setInterval(() => {
      index = advanceMockStreamIndex(index, chunkSize, fixture.length);
      setContent(mockStreamContent(index, fixture));
      if (isMockStreamComplete(index, fixture.length)) {
        clearTimer();
        setIsStreaming(false);
      }
    }, intervalMs);
  }, [clearTimer, fixture, speed]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  return { content, isStreaming, start, reset };
}
