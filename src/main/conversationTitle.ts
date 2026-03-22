import OpenAI from "openai";
import type { ChatMessage } from "../shared/types";
import { notifyConversationTitleUpdated } from "./titleEvents";
import {
  getConversationMetaForId,
  patchConversationMeta,
  getMessages,
} from "./memory";

const MAX_TITLE_WORDS = 4;
const CONTEXT_MAX_CHARS = 2400;

/** Normalize model output or heuristic text to at most four words. */
export function clampToFourWords(raw: string): string {
  const cleaned = raw
    .replace(/["'`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  const words = cleaned.split(" ").filter(Boolean).slice(0, MAX_TITLE_WORDS);
  return words
    .map((w) => (w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function stripLeadingFiller(text: string): string {
  let t = text.trim().replace(/\s+/g, " ");
  const patterns = [
    /^how do i\s+/i,
    /^how can i\s+/i,
    /^can you\s+/i,
    /^could you\s+/i,
    /^please\s+/i,
    /^i want to\s+/i,
    /^i need to\s+/i,
    /^help me\s+/i,
  ];
  for (const re of patterns) {
    t = t.replace(re, "");
  }
  return t.trim();
}

/** First-line, heuristic title before the model runs (instant sidebar label). */
export function heuristicTitleFromUserMessage(userContent: string): string {
  const line = userContent.split("\n")[0] ?? "";
  const stripped = stripLeadingFiller(line);
  if (!stripped) return "";
  const noCode = stripped.replace(/`[^`]*`/g, " ").replace(/\s+/g, " ").trim();
  return clampToFourWords(noCode);
}

function countUserMessages(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "user").length;
}

function buildRollingContext(messages: ChatMessage[]): string {
  const parts: string[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0 && total < CONTEXT_MAX_CHARS; i--) {
    const m = messages[i];
    const prefix = m.role === "user" ? "User" : "Assistant";
    const chunk = `${prefix}: ${m.content}`;
    parts.unshift(chunk);
    total += chunk.length;
  }
  const joined = parts.join("\n\n");
  if (joined.length <= CONTEXT_MAX_CHARS) return joined;
  return joined.slice(-CONTEXT_MAX_CHARS);
}

function shouldRunLlmRefinement(userCount: number, lastRefinementUserCount: number | undefined): boolean {
  if (userCount < 1) return false;
  if (lastRefinementUserCount === undefined) {
    return userCount === 1 || (userCount >= 4 && userCount % 4 === 0);
  }
  if (userCount === 1) return lastRefinementUserCount < 1;
  if (userCount % 4 !== 0) return false;
  return userCount > lastRefinementUserCount;
}

export function applyHeuristicTitleIfEmpty(conversationId: string, userContent: string): void {
  const meta = getConversationMetaForId(conversationId);
  if (!meta) return;
  if (meta.titleSource === "user" || meta.titleSource === "imported") return;
  if (meta.title !== null && meta.title !== "") return;
  const h = heuristicTitleFromUserMessage(userContent);
  if (!h) return;
  patchConversationMeta(conversationId, { title: h, titleSource: "auto" });
  notifyConversationTitleUpdated(conversationId);
}

async function generateTitleWithOpenAI(
  apiKey: string,
  model: string,
  previousTitle: string | null,
  context: string
): Promise<string | null> {
  const client = new OpenAI({ apiKey });
  const system =
    "You name chat threads for a sidebar. Reply with at most four words describing the main topic. " +
    "No quotes or punctuation except spaces between words. " +
    "If the previous title still fits the recent conversation, reply with exactly: UNCHANGED";

  const userBlock = [
    previousTitle ? `Previous title: ${previousTitle}` : "Previous title: (none)",
    "",
    "Recent conversation:",
    context,
  ].join("\n");

  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userBlock },
    ],
    max_tokens: 48,
    temperature: 0.35,
  });

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) return null;
  if (/^UNCHANGED$/i.test(raw)) return null;
  const clamped = clampToFourWords(raw);
  return clamped || null;
}

/**
 * After an assistant message is persisted: maybe refine title with the LLM (lazy, non-blocking).
 * Skips user/imported titles. First refinement after the first exchange; then every 4th user message.
 */
export function scheduleConversationTitleRefinement(
  conversationId: string,
  apiKey: string,
  model: string
): void {
  void (async () => {
    try {
      const meta = getConversationMetaForId(conversationId);
      if (!meta) return;
      if (meta.titleSource === "user" || meta.titleSource === "imported") return;

      const messages = getMessages(conversationId);
      const userCount = countUserMessages(messages);
      const lastRef = meta.lastTitleRefinementUserCount;

      if (!shouldRunLlmRefinement(userCount, lastRef)) return;

      const context = buildRollingContext(messages);
      if (!context.trim()) return;

      const previousTitle = meta.title;
      const generated = await generateTitleWithOpenAI(apiKey, model, previousTitle, context);
      const fallback =
        generated ??
        (previousTitle && previousTitle.trim() ? previousTitle : heuristicFromFirstUser(messages));

      if (!fallback?.trim()) return;

      const finalTitle = clampToFourWords(fallback);
      if (!finalTitle) return;

      patchConversationMeta(conversationId, {
        title: finalTitle,
        titleSource: "auto",
        lastTitleRefinementUserCount: userCount,
      });
      notifyConversationTitleUpdated(conversationId);
    } catch {
      // Non-fatal: keep heuristic or prior title
    }
  })();
}

function heuristicFromFirstUser(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first?.content) return "";
  return heuristicTitleFromUserMessage(first.content);
}
