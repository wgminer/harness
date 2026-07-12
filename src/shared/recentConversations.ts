/** Deterministic recent-chat dialogue cleaning for prompt injection (mirrors Rust/iOS). */

export const RECENT_PER_CHAT_BODY_BUDGET = 2000;
export const RECENT_TOTAL_BODY_BUDGET = 8000;
export const RECENT_PROTECT_RECENT_COUNT = 3;

const SENT_AT_PREFIX = /^\[sent_at=[^\]]+\]\n?/;

export function stripSentAtPrefix(content: string): string {
  return content.replace(SENT_AT_PREFIX, "");
}

export type RecentDialogueTurn = { role: "User" | "Assistant"; text: string };

export function extractDialogueTurns(
  messages: Array<{ role: string; content: string; toolCalls?: unknown[] }>,
): RecentDialogueTurn[] {
  const turns: RecentDialogueTurn[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const trimmed = message.content.trim();
    if (message.role === "assistant") {
      const hasTools = Array.isArray(message.toolCalls) && message.toolCalls.length > 0;
      if (hasTools && trimmed.length === 0) continue;
    }
    const text = stripSentAtPrefix(trimmed);
    if (!text) continue;
    turns.push({ role: message.role === "user" ? "User" : "Assistant", text });
  }
  return turns;
}

export function cleanDialogueBody(
  messages: Array<{ role: string; content: string; toolCalls?: unknown[] }>,
  perChatBudget = RECENT_PER_CHAT_BODY_BUDGET,
): string {
  return windowDialogueFromEnd(extractDialogueTurns(messages), perChatBudget);
}

function formatTurn(label: "User" | "Assistant", text: string): string {
  return `${label}: ${text}`;
}

function truncateTail(text: string, maxChars: number): string {
  if ([...text].length <= maxChars) return text;
  const keep = Math.max(0, maxChars - 1);
  const tail = [...text].slice(-keep).join("");
  return `…${tail}`;
}

function windowDialogueFromEnd(turns: RecentDialogueTurn[], budget: number): string {
  if (turns.length === 0) return "";

  const selected: RecentDialogueTurn[] = [];
  let used = 0;

  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    const turnText = formatTurn(turn.role, turn.text);
    const turnLen = turnText.length;
    if (turnLen > budget) {
      const tail = truncateTail(turn.text, budget);
      selected.unshift({ role: turn.role, text: tail });
      break;
    }
    if (selected.length > 0 && used + turnLen > budget) break;
    selected.unshift(turn);
    used += turnLen;
  }

  if (selected.length === 0) {
    const last = turns[turns.length - 1];
    selected.push({ role: last.role, text: truncateTail(last.text, budget) });
  }

  return selected.map((turn) => formatTurn(turn.role, turn.text)).join("\n\n");
}

export function applyTotalBodyBudget(
  bodies: string[],
  totalMax = RECENT_TOTAL_BODY_BUDGET,
  protectCount = RECENT_PROTECT_RECENT_COUNT,
): string[] {
  const next = [...bodies];
  let total = next.reduce((sum, body) => sum + body.length, 0);
  if (total <= totalMax) return next;

  const trimPass = (includeProtected: boolean) => {
    const protect = Math.min(protectCount, next.length);
    for (let index = next.length - 1; index >= 0; index -= 1) {
      if (total <= totalMax) break;
      if (index < protect && !includeProtected) continue;
      const excess = total - totalMax;
      const body = next[index];
      if (body.length <= excess) {
        total -= body.length;
        next[index] = "";
        continue;
      }
      const newLen = body.length - excess;
      next[index] = truncateHead(body, newLen);
      total = next.reduce((sum, value) => sum + value.length, 0);
    }
  };

  trimPass(false);
  if (total > totalMax) trimPass(true);
  return next;
}

function truncateHead(text: string, maxChars: number): string {
  if ([...text].length <= maxChars) return text;
  return `${[...text].slice(0, Math.max(0, maxChars - 1)).join("")}…`;
}
