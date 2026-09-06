/** Model id stamped on dummy assistant turns in the browser debug shell. */
export const BROWSER_DUMMY_MODEL = "browser-dummy";

/** Delay before the first dummy token so the stream wait slot can show. */
export const BROWSER_DUMMY_THINK_MS = 4000;

export const BROWSER_DUMMY_CHUNK_CHARS = 4;
export const BROWSER_DUMMY_CHUNK_MS = 36;

export type DummyReplyKind = "short" | "long" | "list" | "code";

const DUMMY_TRIGGER = /\b(short|long|list|code)\b/i;

export function dummyReplyKind(userContent: string): DummyReplyKind {
  const kind = userContent.match(DUMMY_TRIGGER)?.[1]?.toLowerCase();
  if (kind === "short" || kind === "long" || kind === "list" || kind === "code") {
    return kind;
  }
  return "long";
}

function dummyEcho(userContent: string): string {
  const preview = userContent.trim().replace(/\s+/g, " ");
  const clipped = preview.length > 120 ? `${preview.slice(0, 117)}…` : preview;
  return clipped
    ? `You wrote: ${clipped}`
    : "Send another message to keep previewing the wait slot and stream-in.";
}

const DUMMY_BODIES: Record<DummyReplyKind, string> = {
  short: [
    "This is a dummy reply from the browser shell — no API key.",
    "",
    "{echo}",
    "",
    "The first tokens are delayed on purpose so the thinking string can sit in the opening reply slot.",
  ].join("\n"),
  long: [
    "This is a dummy reply from the browser shell — no API key.",
    "",
    "{echo}",
    "",
    "The first tokens are delayed on purpose so the thinking string can sit in the opening reply slot. After that hold, this text ticks in a few characters at a time so you can watch the assistant block grow, wrap, and push the thread the way a real completion would.",
    "",
    "Use this pass to judge spacing around the wait label, how the first paragraph replaces it, and whether later blocks keep the same rhythm. Nothing here is model output. It is fixture copy for layout, scroll, and stream-in — long enough that the reply does not vanish in a blink.",
    "",
    "A few things worth watching while it fills in:",
    "",
    "- The wait string should occupy the first-line slot, then give way without a jump.",
    "- Early lines should read like the start of a normal assistant message, not a status chip.",
    "- As paragraphs accumulate, the latest line should stay clear of the composer.",
    "- Stopping mid-stream should leave a partial reply instead of snapping back to empty.",
    "",
    "Keep sending if you want another pass. Each dummy turn repeats this shape so you can compare the thinking string, the reveal, and the settled markdown without spending a token.",
  ].join("\n"),
  list: [
    "This is a dummy reply from the browser shell — no API key.",
    "",
    "{echo}",
    "",
    "List fixture — watch bullets land after the wait slot:",
    "",
    "- Opening line replaces `THINKING` without a jump",
    "- Nested items keep the same indent as a real reply",
    "  - Second-level item for wrap and hanging indent",
    "  - Another child so the list has some height",
    "- Numbered follow-up for mixed list rhythm",
    "",
    "1. Stream wait occupies the first-line slot",
    "2. First tokens push the thread the way a completion would",
    "3. Settled markdown should match a normal assistant list",
  ].join("\n"),
  code: [
    "This is a dummy reply from the browser shell — no API key.",
    "",
    "{echo}",
    "",
    "Code fixture — a fenced block after a short lead-in, so you can watch the fence close and the highlight settle.",
    "",
    "```ts",
    "export function streamWaitLabel(ready: boolean): string {",
    "  if (!ready) return \"THINKING\";",
    "  return \"\";",
    "}",
    "",
    "const ticks = [\"A3\", \"HOLD\", \"7C\", \"WAIT\"];",
    "for (const tick of ticks) {",
    "  console.log(tick);",
    "}",
    "```",
    "",
    "The paragraph after the fence should sit on the same stack as a real streamed code block.",
  ].join("\n"),
};

export function dummyAssistantReply(userContent: string): string {
  const kind = dummyReplyKind(userContent);
  return DUMMY_BODIES[kind].replace("{echo}", dummyEcho(userContent));
}

export function waitForAbortable(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function streamDummyChat(input: {
  text: string;
  signal: AbortSignal;
  onChunk: (chunk: string) => void;
  thinkMs?: number;
  chunkChars?: number;
  chunkMs?: number;
}): Promise<string> {
  const thinkMs = input.thinkMs ?? BROWSER_DUMMY_THINK_MS;
  const chunkChars = input.chunkChars ?? BROWSER_DUMMY_CHUNK_CHARS;
  const chunkMs = input.chunkMs ?? BROWSER_DUMMY_CHUNK_MS;
  await waitForAbortable(thinkMs, input.signal);
  let full = "";
  for (let i = 0; i < input.text.length; i += chunkChars) {
    if (input.signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    const chunk = input.text.slice(i, i + chunkChars);
    full += chunk;
    input.onChunk(chunk);
    if (i + chunkChars < input.text.length) {
      await waitForAbortable(chunkMs, input.signal);
    }
  }
  return full;
}
