/**
 * Large clipboard pastes in the composer become "pasted text" attachments instead of
 * flooding the textarea. On send they are inlined into the message body inside a
 * `<pasted_text>` wrapper so the model sees the full text with clear boundaries, and
 * the user message card can render them back as collapsed attachments.
 */

/** Pastes at or above either threshold become an attachment. */
export const PASTE_ATTACH_MIN_CHARS = 2000;
export const PASTE_ATTACH_MIN_LINES = 40;

export interface PastedTextBlock {
  id: string;
  text: string;
  /** Source file name when the block came from an attached text file. */
  name?: string;
}

export type MessageSegment =
  | { kind: "text"; text: string }
  | { kind: "pasted"; text: string; name?: string };

const OPEN_TAG = "<pasted_text";
const CLOSE_TAG = "</pasted_text>";
const BLOCK_RE = /<pasted_text(?: name="([^"]*)")?>\n?([\s\S]*?)\n?<\/pasted_text>/g;

function openTag(name?: string): string {
  return name ? `${OPEN_TAG} name="${name.replace(/"/g, "'")}">` : `${OPEN_TAG}>`;
}

export function shouldAttachPaste(text: string): boolean {
  if (text.length >= PASTE_ATTACH_MIN_CHARS) return true;
  let lines = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10 && ++lines >= PASTE_ATTACH_MIN_LINES) return true;
  }
  return false;
}

export function countLines(text: string): number {
  if (!text) return 0;
  return text.replace(/\n+$/, "").split("\n").length;
}

/** Short size label for a pasted block chip, e.g. "240 lines" or "1.2k chars". */
export function pastedTextSizeLabel(text: string): string {
  const lines = countLines(text);
  if (lines > 1) return `${lines.toLocaleString()} lines`;
  const chars = text.length;
  return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k chars` : `${chars} chars`;
}

/** First non-empty line, for chip previews. */
export function pastedTextPreview(text: string, max = 60): string {
  const first = text.split("\n").find((line) => line.trim())?.trim() ?? "";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
}

/** Joins the typed draft and pasted blocks into the message body sent to the model. */
export function composeMessageWithPastes(text: string, blocks: readonly PastedTextBlock[]): string {
  const parts = text.trim() ? [text.trim()] : [];
  for (const block of blocks) {
    parts.push(`${openTag(block.name)}\n${block.text.replace(/\n+$/, "")}\n${CLOSE_TAG}`);
  }
  return parts.join("\n\n");
}

/** Splits a stored user message back into typed text and pasted blocks. */
export function splitPastedSegments(content: string): MessageSegment[] {
  if (!content.includes(OPEN_TAG)) return [{ kind: "text", text: content }];
  const segments: MessageSegment[] = [];
  let last = 0;
  for (const match of content.matchAll(BLOCK_RE)) {
    const start = match.index ?? 0;
    const before = content.slice(last, start).trim();
    if (before) segments.push({ kind: "text", text: before });
    segments.push(
      match[1] ? { kind: "pasted", text: match[2], name: match[1] } : { kind: "pasted", text: match[2] },
    );
    last = start + match[0].length;
  }
  const rest = content.slice(last).trim();
  if (rest) segments.push({ kind: "text", text: rest });
  return segments;
}
