import { ipcMain, BrowserWindow } from "electron";
import OpenAI from "openai";
import { getSettings } from "./settings";
import { getMessages, getUserMemory, appendMessage } from "./memory";
import { applyHeuristicTitleIfEmpty, scheduleConversationTitleRefinement } from "./conversationTitle";
import { sendMessageWithTools } from "./providers/openai";
import { executeFileTool } from "./fileTools";
import { executeCustomizationTool } from "./customization";
import { executeAssistantTool, isAssistantToolName } from "./assistantTools";
import type { ChatMessage } from "../shared/types";

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

function buildMessageList(conversationId: string, userContent: string): ChatMessage[] {
  const userMemory = getUserMemory();
  const memoryBlock =
    Object.keys(userMemory).length > 0
      ? "User context / remembered facts:\n" +
        Object.entries(userMemory)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join("\n")
      : "";

  const systemPrompt =
    "Helpful assistant running in a local desktop app. Available tools: list_directory, read_file, write_file, delete_file, create_directory (for file operations); update_theme and set_layout (to change app appearance); task_list, task_create, task_update, task_delete, task_clear_completed (for a persistent task list visible in a dedicated panel); and memory_set_fact, memory_list_facts, memory_search_conversations (to remember stable user facts and search across prior conversations). Call them when appropriate."
    + (memoryBlock ? "\n\n" + memoryBlock : "");

  const history = getMessages(conversationId);
  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt }];
  for (const m of history) {
    messages.push(m);
  }
  messages.push({ role: "user", content: userContent });
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
      result = executeAssistantTool(name, args);
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

export function registerChatHandlers(): void {
  ipcMain.handle(
    "chat:send",
    async (_e, conversationId: string, userContent: string) => {
      const settings = getSettings();
      const apiKey = settings.openai?.apiKey ?? "";
      const model = settings.openai?.model ?? "gpt-5.2";
      if (!apiKey) {
        throw new Error("OpenAI API key not set. Configure it in Settings.");
      }

      const messages = buildMessageList(conversationId, userContent);
      appendMessage(conversationId, "user", userContent);
      applyHeuristicTitleIfEmpty(conversationId, userContent);

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

      let didAppendAssistant = false;
      try {
        const stream = await sendMessageWithTools(
          apiKey,
          model,
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
          appendMessage(conversationId, "assistant", fullContent, toolCallsThisTurn.length > 0 ? { toolCalls: toolCallsThisTurn } : undefined);
          didAppendAssistant = true;
        }
      } catch (err) {
        win?.webContents.send("chat:streamEnd", conversationId);
        const isAbort =
          err instanceof OpenAI.APIUserAbortError || (err instanceof Error && err.name === "AbortError");
        if (fullContent || toolCallsThisTurn.length > 0) {
          appendMessage(conversationId, "assistant", fullContent || "[Error]", toolCallsThisTurn.length > 0 ? { toolCalls: toolCallsThisTurn } : undefined);
          didAppendAssistant = true;
        } else if (!isAbort) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          appendMessage(conversationId, "assistant", `[Error: ${errorMessage}]`);
          didAppendAssistant = true;
        }
        if (!isAbort) throw err;
      } finally {
        activeAbortController = null;
        if (didAppendAssistant) {
          scheduleConversationTitleRefinement(conversationId, apiKey, model);
        }
      }
    }
  );

  ipcMain.handle("chat:stop", () => {
    if (activeAbortController) {
      activeAbortController.abort();
    }
  });

  ipcMain.handle(
    "chat:resolveGatedTool",
    (_e, pendingId: string, action: "proceed" | "cancel") => {
      const pending = pendingGatedTools.get(pendingId);
      if (!pending) return;
      pendingGatedTools.delete(pendingId);
      if (action === "proceed") {
        try {
          const result = executeAssistantTool(pending.tool, pending.args);
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
