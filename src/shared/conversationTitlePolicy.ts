import { isTimePlaceholderTitle } from "./conversationSession";
import type { ChatMessage } from "./types";

const REFINE_EVERY = 4;

/** When to run the title LLM (user-only dictation threads included). */
export function shouldRefineConversationTitle(
  messages: ChatMessage[],
  title?: string | null
): boolean {
  const users = messages.filter((m) => m.role === "user").length;
  const assistants = messages.filter((m) => m.role === "assistant").length;
  if (users < 1) return false;
  if (assistants === 0) {
    return users === 1 && isTimePlaceholderTitle(title);
  }
  if (assistants === 1) return true;
  return users > 1 && users % REFINE_EVERY === 0;
}
