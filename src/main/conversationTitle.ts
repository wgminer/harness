import { shouldRefineConversationTitle } from "../shared/conversationTitlePolicy";
import type { ChatMessage } from "../shared/types";
import { generateThreadTitleWithOpenAI } from "./providers/openai";
import {
  notifyConversationTitleUpdated,
  notifyTitleGenerationStarted,
  notifyTitleGenerationEnded,
} from "./titleEvents";
import { getSettings } from "./settings";
import {
  getConversationMetaForId,
  patchConversationMeta,
  getMessages,
} from "./memory";
import { isHarnessE2E } from "./e2eStub";

const CONTEXT_MAX_CHARS = 2400;

function cleanTitle(raw: string): string {
  return raw.replace(/["'`]/g, "").replace(/\s+/g, " ").trim();
}

function buildContext(messages: ChatMessage[]): string {
  const parts: string[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0 && total < CONTEXT_MAX_CHARS; i--) {
    const m = messages[i];
    const chunk = `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`;
    parts.unshift(chunk);
    total += chunk.length;
  }
  const joined = parts.join("\n\n");
  return joined.length <= CONTEXT_MAX_CHARS ? joined : joined.slice(-CONTEXT_MAX_CHARS);
}

/**
 * Fire-and-forget: generate or refine the conversation title after an assistant reply is persisted.
 * Gating uses message roles (including user-only dictation threads).
 * Never touches user-set or imported titles.
 * Requires an OpenAI API key; skips silently when missing.
 */
export function scheduleConversationTitleRefinement(conversationId: string): void {
  if (isHarnessE2E()) return;
  void (async () => {
    let notifiedStart = false;
    try {
      const messages = await getMessages(conversationId);
      const meta = await getConversationMetaForId(conversationId);
      if (!meta || meta.titleSource === "user" || meta.titleSource === "imported") return;
      if (!shouldRefineConversationTitle(messages, meta.title)) return;

      const context = buildContext(messages);
      if (!context.trim()) return;

      const settings = await getSettings();
      const openaiKey = settings.openai?.apiKey?.trim();
      if (!openaiKey) return;

      notifyTitleGenerationStarted(conversationId);
      notifiedStart = true;

      const rawTitle = await generateThreadTitleWithOpenAI(openaiKey, meta.title, context);
      const title = cleanTitle(rawTitle ?? "");
      if (!title) return;

      await patchConversationMeta(conversationId, { title, titleSource: "auto" });
      notifyConversationTitleUpdated(conversationId);
    } catch (err) {
      console.error("[title] LLM title generation failed:", err);
    } finally {
      if (notifiedStart) {
        notifyTitleGenerationEnded(conversationId);
      }
    }
  })();
}
