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
import { HARNESS_E2E_ASSISTANT_REPLY, isHarnessE2E } from "./e2eStub";

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

async function buildMessageList(
  conversationId: string,
  userContent?: string,
  secondUserContent?: string
): Promise<ChatMessage[]> {
  const userMemory = await getUserMemory();
  const memoryBlock =
    Object.keys(userMemory).length > 0
      ? "User context / remembered facts:\n" +
        Object.entries(userMemory)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")
      : "";

  const systemPrompt =
    "Helpful assistant running in a local desktop app. Available tools: list_directory, read_file, write_file, delete_file, create_directory (for file operations); update_theme and set_layout (to change app appearance); task_list, task_create, task_update, task_delete, task_clear_completed (for a persistent tagged task list visible in a dedicated panel); memory_set_fact, memory_list_facts, memory_search_conversations (to remember stable user facts and search across prior conversations); and get_datetime (for the current date and time, optionally in a specific IANA timezone). Call them when appropriate." +
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
    win?.webContents.send("chat:streamChunk", conversationId, synthetic);
    win?.webContents.send("chat:streamEnd", conversationId);
    await appendMessage(conversationId, "assistant", synthetic, {
      timestamp: Date.now(),
      model: modelLabel,
    });
    return;
  }

  if (!settings.openai?.apiKey) {
    throw new Error("OpenAI API key not set. Configure it in Settings.");
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
