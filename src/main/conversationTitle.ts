import type { ChatMessage } from "../shared/types";
import type { LLMProvider } from "./providers/types";
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
const REFINE_EVERY = 4;

/**
 * Run title LLM when there is at least one assistant reply (so we have real context),
 * and either it's the first assistant message (replaces placeholders like voice dictation)
 * or we're at a periodic refinement milestone.
 */
function shouldRefineTitle(messages: ChatMessage[]): boolean {
  const users = messages.filter((m) => m.role === "user").length;
  const assistants = messages.filter((m) => m.role === "assistant").length;
  if (users < 1 || assistants < 1) return false;
  if (assistants === 1) return true;
  return users > 1 && users % REFINE_EVERY === 0;
}

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
 * Gating uses message roles (assistant present / first reply), not whether a title string is empty.
 * Never touches user-set or imported titles.
 */
export function scheduleConversationTitleRefinement(conversationId: string, provider: LLMProvider): void {
  if (isHarnessE2E()) return;
  void (async () => {
    let notifiedStart = false;
    try {
      const messages = await getMessages(conversationId);
      if (!shouldRefineTitle(messages)) return;

      const meta = await getConversationMetaForId(conversationId);
      if (!meta || meta.titleSource === "user" || meta.titleSource === "imported") return;

      const context = buildContext(messages);
      if (!context.trim()) return;

      notifyTitleGenerationStarted(conversationId);
      notifiedStart = true;

      const settings = await getSettings();
      const openaiKey = settings.openai?.apiKey?.trim();
      const rawTitle = openaiKey
        ? await generateThreadTitleWithOpenAI(openaiKey, meta.title, context)
        : await provider.generateTitle(meta.title, context, "");
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
