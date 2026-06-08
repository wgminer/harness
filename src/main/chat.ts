import { ipcMain, BrowserWindow } from "electron";
import OpenAI from "openai";
import { getSettings } from "./settings";
import { getMessages, getUserMemory, appendMessage, popLastUserMessage } from "./memory";
import {
  annotateMessageContentForModel,
  formatTemporalContextBlock,
  stripSentAtPrefix,
} from "../shared/chatTemporalContext";
import {
  formatMemoryContextBlock,
  parseMemoryInjectionStrategy,
  selectMemoryEntriesForPrompt,
} from "../shared/memoryInjection";
import { DICTATION_POLISH_INSTRUCTION } from "../shared/dictationPolish";
import { scheduleConversationTitleRefinement } from "./conversationTitle";
import { getProvider } from "./providers/registry";
import { executeFileTool } from "./fileTools";
import { executeCustomizationTool, isCustomizationToolName } from "./customization";
import { executeAssistantTool, isAssistantToolName } from "./assistantTools";
import type { ChatMessage } from "../shared/types";
import { OPENAI_CHAT_MODEL } from "../shared/openaiModels";
import { HARNESS_E2E_ASSISTANT_REPLY, getHarnessE2EStreamDelayMs, isHarnessE2E } from "./e2eStub";
import { RIG_PAGE_TITLE } from "../shared/rigPage";

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
  const settings = await getSettings();
  const strategy = parseMemoryInjectionStrategy(settings.memory?.injectionStrategy);
  const userMemory = await getUserMemory();
  const scoringContent = userContent ?? secondUserContent;
  const selectedMemory = selectMemoryEntriesForPrompt(strategy, userMemory, scoringContent);
  const memoryBlock = formatMemoryContextBlock(selectedMemory);

  const systemPrompt =
    [
      "[CORE_INSTRUCTIONS]",
      "You are a helpful assistant running in a local desktop app.",
      "Prefer concise, practical, high-signal responses.",
      "For complex writing/thinking tasks, start with structure (questions, outline, tradeoffs) unless the user explicitly asks for a full draft immediately.",
      "Available tools: list_directory, read_file, write_file, delete_file, create_directory (for file operations); get_theme, update_theme, apply_theme_preset, and set_layout (app appearance — call get_theme before edits; presets: night, paper, matcha, ik_blue, bloomberg); task_list, task_create, task_update, task_delete, task_clear_completed (persistent tasks with status pending/in_progress/completed/cancelled plus filterable tags; use task_update status for completion, tags/add_tags/remove_tags for labels); memory_set_fact, memory_list_facts, memory_search_conversations (to remember stable user facts and search across prior conversations); get_datetime (for the current date and time, optionally in a specific IANA timezone); get_weather (current conditions and a short daily forecast for a US ZIP; call with no arguments to use the user's default ZIP from Settings); web_search (Tavily web search for current information outside the user's local data); note_list, note_create, note_read, note_save, note_delete (for persistent notes separate from chat; short saved snippets belong in a note titled \"Clippings\" as a numbered markdown list, optionally with inline #tags). Call them when appropriate.",
      "",
      "[FORMATTING_CAPABILITIES]",
      "Standard markdown (bold, italic, lists, tables, fenced code, blockquotes) is supported. Use plain prose by default. Only reach for the layout blocks below when they add genuine clarity over a paragraph or list. Never wrap an entire reply in a single block.",
      "",
      "Callouts — one sentence of emphasis, not a heading replacement:",
      "  :::tip",
      "  Short suggestion.",
      "  :::",
      "  (variants: :::tip, :::note, :::warning, :::danger)",
      "",
      "Collapsible — fold away long context or sources the user may not need:",
      "  :::details{summary=\"Sources\"}",
      "  Long content.",
      "  :::",
      "",
      "Inline chip — a short status tag inside a sentence:",
      "  Build is :chip[failing]{tone=danger}.",
      "  (tones: info, warn, danger, success, neutral)",
      "",
      "Link card — only when surfacing a single primary URL the user should open:",
      "  :::link{url=\"https://example.com\" title=\"Example\" desc=\"One-line summary.\" site=\"example.com\"}",
      "  :::",
      "",
      "Mermaid diagrams — for flows, sequences, small state diagrams:",
      "  ```mermaid",
      "  flowchart LR",
      "    A --> B",
      "  ```",
      "",
      "Options compare — exactly 2-5 alternatives the user must choose between. Outer fence uses FOUR colons so the inner :::option fences nest cleanly:",
      "  ::::options{title=\"Pick an approach\"}",
      "  :::option{title=\"Redis\" recommended}",
      "  Fast and proven. Adds an ops dependency.",
      "  :::",
      "  :::option{title=\"In-memory\"}",
      "  Zero ops. Cache is lost on restart.",
      "  :::",
      "  ::::",
      "",
      "Slide deck — a small inline deck (max ~6 slides). Outer fence uses FOUR colons. Layouts: title, bullets, quote, blank.",
      "  ::::slides",
      "  :::slide{layout=title title=\"Q3 Review\" subtitle=\"Highlights\"}",
      "  :::",
      "  :::slide{layout=bullets title=\"Wins\"}",
      "  - Shipped feature X",
      "  - Closed deal Y",
      "  :::",
      "  :::slide{layout=quote attribution=\"— Lee\"}",
      "  Make it work, then make it fast.",
      "  :::",
      "  :::slide{layout=blank title=\"Notes\"}",
      "  Free-form markdown body.",
      "  :::",
      "  ::::",
      "",
      "Rules of thumb: prefer plain prose first; use at most one layout block per reply unless the user is explicitly asking for a comparison or a deck; never nest :::slides inside another directive; do not use callouts as section headers.",
    ].join("\n") +
    (memoryBlock ? "\n\n" + memoryBlock : "") +
    "\n\n" +
    formatTemporalContextBlock();

  const history = await getMessages(conversationId);
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  const nowMs = Date.now();
  for (const m of history) {
    if (m.role === "system") {
      messages.push(m);
      continue;
    }
    messages.push({
      ...m,
      content: annotateMessageContentForModel(m.content, m.timestamp),
    });
  }
  if (userContent) {
    messages.push({
      role: "user",
      content: annotateMessageContentForModel(userContent, nowMs),
    });
  }
  if (secondUserContent) {
    messages.push({
      role: "user",
      content: annotateMessageContentForModel(secondUserContent, nowMs + 1),
    });
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

  if (isCustomizationToolName(name)) {
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
    throw new Error(`OpenAI API key not set. Configure it in ${RIG_PAGE_TITLE}.`);
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
      await appendMessage(conversationId, "assistant", stripSentAtPrefix(fullContent), {
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
      await appendMessage(conversationId, "assistant", stripSentAtPrefix(fullContent) || "[Error]", {
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
