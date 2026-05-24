import { ipcMain, BrowserWindow } from "electron";
import OpenAI from "openai";
import { getSettings } from "./settings";
import { getMessages, getUserMemory, appendMessage, popLastUserMessage } from "./memory";
import { DICTATION_POLISH_INSTRUCTION } from "../shared/dictationPolish";
import { scheduleConversationTitleRefinement } from "./conversationTitle";
import { getProvider } from "./providers/registry";
import { executeFileTool } from "./fileTools";
import { executeCustomizationTool } from "./customization";
import { executeAssistantTool, isAssistantToolName } from "./assistantTools";
import type { ChatMessage } from "../shared/types";
import { OPENAI_CHAT_MODEL } from "../shared/openaiModels";
import { HARNESS_E2E_ASSISTANT_REPLY, getHarnessE2EStreamDelayMs, isHarnessE2E } from "./e2eStub";

function activeChatModelLabel(): string {
  return OPENAI_CHAT_MODEL;
}

let activeAbortController: AbortController | null = null;

/** Pending gated tool calls: promise is resolved when the user clicks Proceed or Cancel in the UI. */
const pendingGatedTools = new Map<
  string,
  { resolve: (result: string) => void; reject: (err: Error) => void; tool: string; args: Record<string, unknown> }
>();

function getMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows();
  return wins.length > 0 ? wins[0] : null;
}

const MEMORY_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "we",
  "with",
  "you",
  "your",
]);

const MEMORY_ALWAYS_RELEVANT_KEY_PARTS = ["writing", "tone", "style", "voice", "goal", "audience", "constraint"];
const MAX_MEMORY_ENTRIES = 6;
const MAX_MEMORY_CHARS = 900;
const MIN_MEMORY_SCORE = 0.65;

function toTokens(text: string): string[] {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 3 && !MEMORY_STOPWORDS.has(t));
}

function countOverlap(base: Set<string>, candidates: string[]): number {
  let count = 0;
  for (const token of candidates) {
    if (base.has(token)) count += 1;
  }
  return count;
}

function scoreMemoryEntry(key: string, value: string, userContent: string): number {
  const userTokens = new Set(toTokens(userContent));
  if (userTokens.size === 0) return 0;
  const keyTokens = toTokens(key);
  const valueTokens = toTokens(value);
  const keyMatches = countOverlap(userTokens, keyTokens);
  const valueMatches = countOverlap(userTokens, valueTokens);
  const tokenNorm = Math.sqrt(Math.max(1, keyTokens.length + valueTokens.length));
  let score = (keyMatches * 2 + valueMatches) / tokenNorm;
  const keyLower = key.toLowerCase();
  if (MEMORY_ALWAYS_RELEVANT_KEY_PARTS.some((part) => keyLower.includes(part))) score += 1;
  const extraChars = Math.max(0, value.length - 260);
  score -= (extraChars / 200) * 0.2;
  return score;
}

function selectRelevantMemoryEntries(
  userMemory: Record<string, string>,
  userContent?: string
): Array<[key: string, value: string]> {
  const entries = Object.entries(userMemory).filter(([k]) => k.trim().length > 0);
  if (entries.length === 0) return [];
  if (!userContent?.trim()) return entries.slice(0, 3);

  const scored = entries
    .map(([key, value]) => ({ key, value, score: scoreMemoryEntry(key, value, userContent) }))
    .filter((row) => row.score >= MIN_MEMORY_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_MEMORY_ENTRIES);

  let usedChars = 0;
  const selected: Array<[string, string]> = [];
  for (const row of scored) {
    const nextLine = `- ${row.key}: ${row.value}`;
    if (selected.length > 0 && usedChars + nextLine.length > MAX_MEMORY_CHARS) break;
    selected.push([row.key, row.value]);
    usedChars += nextLine.length;
  }
  return selected;
}

function splitIntoWordChunks(content: string): string[] {
  const parts = content.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return [content];
  return parts.map((word, idx) => (idx < parts.length - 1 ? `${word} ` : word));
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildMessageList(
  conversationId: string,
  userContent?: string,
  secondUserContent?: string
): Promise<ChatMessage[]> {
  const userMemory = await getUserMemory();
  const selectedMemory = selectRelevantMemoryEntries(userMemory, userContent);
  const memoryBlock =
    selectedMemory.length > 0
      ? [
          "[USER_MEMORY_CONTEXT]",
          "Use only if relevant to the current request.",
          ...selectedMemory.map(([k, v]) => `- ${k}: ${v}`),
          "",
          "[MEMORY_RULES]",
          "- Treat memory as hints, not absolute truth.",
          "- If memory conflicts with the user's current message, follow the current message.",
          "- If uncertain whether memory still applies, ask one brief clarifying question.",
        ].join("\n")
      : "";

  const systemPrompt =
    [
      "[CORE_INSTRUCTIONS]",
      "You are a helpful assistant running in a local desktop app.",
      "Prefer concise, practical, high-signal responses.",
      "For complex writing/thinking tasks, start with structure (questions, outline, tradeoffs) unless the user explicitly asks for a full draft immediately.",
      "Available tools: list_directory, read_file, write_file, delete_file, create_directory (for file operations); update_theme and set_layout (to change app appearance); task_list, task_create, task_update, task_delete, task_clear_completed (for a persistent tagged task list visible in a dedicated panel); memory_set_fact, memory_list_facts, memory_search_conversations (to remember stable user facts and search across prior conversations); get_datetime (for the current date and time, optionally in a specific IANA timezone); get_weather (current conditions and a short daily forecast for a US ZIP; call with no arguments to use the user's default ZIP from Settings); and note_list, note_create, note_read, note_save, note_delete (for persistent notes separate from chat). Call them when appropriate.",
    ].join("\n") +
    (memoryBlock ? "\n\n" + memoryBlock : "");

  const history = await getMessages(conversationId);
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  for (const m of history) {
    messages.push(m);
  }
  if (userContent) {
    messages.push({ role: "user", content: userContent });
  }
  if (secondUserContent) {
    messages.push({ role: "user", content: secondUserContent });
  }
  return messages;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  conversationId: string
): Promise<string> {
  let result: string;
  let skipToolPanelUpdate = false;

  const GATED_ASSISTANT_TOOLS = new Set(["task_delete", "task_clear_completed", "task_update"]);

  if (["update_theme", "set_layout"].includes(name)) {
    result = await Promise.resolve(executeCustomizationTool(name, args));
  } else if (isAssistantToolName(name)) {
    if (GATED_ASSISTANT_TOOLS.has(name)) {
      const pendingId = crypto.randomUUID();
      const pendingPayload = {
        pending: true as const,
        tool: name,
        args,
        pendingId,
      };
      const win = getMainWindow();
      if (win) {
        win.webContents.send("chat:toolPanelUpdate", conversationId, name, pendingPayload);
      }
      result = await new Promise<string>((resolve, reject) => {
        pendingGatedTools.set(pendingId, {
          resolve,
          reject,
          tool: name,
          args,
        });
      });
      skipToolPanelUpdate = true; // UI already updated via handleToolConfirm
    } else {
      result = await executeAssistantTool(name, args);
    }
  } else {
    result = executeFileTool(name, args);
  }

  const win = getMainWindow();
  if (win && isAssistantToolName(name) && !skipToolPanelUpdate) {
    let payload: unknown;
    try {
      payload = JSON.parse(result);
    } catch {
      payload = result;
    }
    win.webContents.send("chat:toolPanelUpdate", conversationId, name, payload);
  }

  return result;
}

async function streamAssistantReply(conversationId: string, messages: ChatMessage[]): Promise<void> {
  const settings = await getSettings();
  const provider = getProvider(settings);

  if (isHarnessE2E()) {
    const win = getMainWindow();
    const modelLabel = activeChatModelLabel();
    const synthetic = HARNESS_E2E_ASSISTANT_REPLY;
    const streamDelayMs = getHarnessE2EStreamDelayMs();
    activeAbortController = new AbortController();
    let emitted = "";
    if (streamDelayMs <= 0) {
      emitted = synthetic;
      win?.webContents.send("chat:streamChunk", conversationId, synthetic);
    } else {
      for (const chunk of splitIntoWordChunks(synthetic)) {
        if (activeAbortController.signal.aborted) break;
        emitted += chunk;
        win?.webContents.send("chat:streamChunk", conversationId, chunk);
        await wait(streamDelayMs);
      }
    }
    win?.webContents.send("chat:streamEnd", conversationId);
    if (emitted) {
      await appendMessage(conversationId, "assistant", emitted, {
        timestamp: Date.now(),
        model: modelLabel,
      });
      scheduleConversationTitleRefinement(conversationId);
    }
    activeAbortController = null;
    return;
  }

  if (!settings.openai?.apiKey) {
    throw new Error("OpenAI API key not set. Configure it in Config.");
  }

  const win = getMainWindow();
  let fullContent = "";
  const toolCallsThisTurn: Array<{ toolName: string; payload: unknown }> = [];
  activeAbortController = new AbortController();

  const executeToolAndCollect = async (name: string, args: Record<string, unknown>): Promise<string> => {
    const result = await executeTool(name, args, conversationId);
    if (isAssistantToolName(name)) {
      try {
        toolCallsThisTurn.push({ toolName: name, payload: JSON.parse(result) });
      } catch {
        toolCallsThisTurn.push({ toolName: name, payload: result });
      }
    }
    return result;
  };

  const modelLabel = activeChatModelLabel();

  let didAppendAssistant = false;
  try {
    const stream = await provider.sendMessageWithTools(
      messages,
      executeToolAndCollect,
      activeAbortController.signal
    );
    for await (const chunk of stream) {
      fullContent += chunk;
      win?.webContents.send("chat:streamChunk", conversationId, chunk);
    }
    win?.webContents.send("chat:streamEnd", conversationId);
    if (fullContent || toolCallsThisTurn.length > 0) {
      await appendMessage(conversationId, "assistant", fullContent, {
        timestamp: Date.now(),
        model: modelLabel,
        ...(toolCallsThisTurn.length > 0 ? { toolCalls: toolCallsThisTurn } : {}),
      });
      didAppendAssistant = true;
    }
  } catch (err) {
    win?.webContents.send("chat:streamEnd", conversationId);
    const isAbort =
      err instanceof OpenAI.APIUserAbortError || (err instanceof Error && err.name === "AbortError");
    if (fullContent || toolCallsThisTurn.length > 0) {
      await appendMessage(conversationId, "assistant", fullContent || "[Error]", {
        timestamp: Date.now(),
        model: modelLabel,
        ...(toolCallsThisTurn.length > 0 ? { toolCalls: toolCallsThisTurn } : {}),
      });
      didAppendAssistant = true;
    } else if (!isAbort) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      await appendMessage(conversationId, "assistant", `[Error: ${errorMessage}]`, {
        timestamp: Date.now(),
        model: modelLabel,
      });
      didAppendAssistant = true;
    }
    if (!isAbort) throw err;
  } finally {
    activeAbortController = null;
    if (didAppendAssistant) {
      scheduleConversationTitleRefinement(conversationId);
    }
  }
}

export function registerChatHandlers(): void {
  ipcMain.handle(
    "chat:send",
    async (_e, conversationId: string, userContent: string) => {
      const messages = await buildMessageList(conversationId, userContent);
      await appendMessage(conversationId, "user", userContent, { timestamp: Date.now() });
      await streamAssistantReply(conversationId, messages);
    }
  );

  /** Pop last user message, then send polish instruction + that text as two user messages and stream. */
  ipcMain.handle("chat:polishLastUser", async (_e, conversationId: string) => {
    const transcript = await popLastUserMessage(conversationId);
    if (transcript == null) {
      throw new Error("No user message to polish.");
    }
    const instruction = DICTATION_POLISH_INSTRUCTION;
    const t1 = Date.now();
    const t2 = t1 + 1;
    const messages = await buildMessageList(conversationId, instruction, transcript);
    await appendMessage(conversationId, "user", instruction, { timestamp: t1 });
    await appendMessage(conversationId, "user", transcript, { timestamp: t2 });
    await streamAssistantReply(conversationId, messages);
  });

  ipcMain.handle(
    "chat:generateReply",
    async (_e, conversationId: string) => {
      const messages = await buildMessageList(conversationId);
      await streamAssistantReply(conversationId, messages);
    }
  );

  ipcMain.handle("chat:stop", () => {
    if (activeAbortController) {
      activeAbortController.abort();
    }
  });

  ipcMain.handle(
    "chat:resolveGatedTool",
    async (_e, pendingId: string, action: "proceed" | "cancel") => {
      const pending = pendingGatedTools.get(pendingId);
      if (!pending) return;
      pendingGatedTools.delete(pendingId);
      if (action === "proceed") {
        try {
          const result = await executeAssistantTool(pending.tool, pending.args);
          pending.resolve(result);
        } catch (err) {
          pending.reject(err instanceof Error ? err : new Error(String(err)));
        }
      } else {
        pending.resolve(JSON.stringify({ cancelled: true, message: "User cancelled the action." }));
      }
    }
  );
}
