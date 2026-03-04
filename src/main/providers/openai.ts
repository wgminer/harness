import OpenAI from "openai";
import type { ChatMessage } from "../../shared/types";
import type { ChatProvider } from "./types";

const TOOL_DEFINITIONS = [
  {
    type: "function" as const,
    function: {
      name: "list_directory",
      description: "List contents of a directory (files and subdirectories). Path must be under allowed roots.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path to the directory" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read plain text content of a file. Size limit 1MB.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path to the file" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Create or overwrite a file with the given content. Path must be under allowed roots.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          content: { type: "string", description: "Content to write" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Delete a file. Path must be under allowed roots.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path to the file" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_directory",
      description: "Create a directory. Path must be under allowed roots.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Absolute path for the new directory" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "update_theme",
      description: "Update the app theme with custom CSS. Call when theme, colors, or appearance are requested.",
      parameters: {
        type: "object",
        properties: { css_content: { type: "string", description: "Valid CSS to apply as overlay" } },
        required: ["css_content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_layout",
      description: "Change app layout: sidebar position (left/right) and density (compact/comfortable).",
      parameters: {
        type: "object",
        properties: {
          sidebar: { type: "string", enum: ["left", "right"], description: "Sidebar position" },
          density: { type: "string", enum: ["compact", "comfortable"], description: "Layout density" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_list",
      description:
        "List all persistent assistant tasks. Use this to understand current open work items before adding or changing tasks.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_create",
      description:
        "Create a new persistent assistant task that will be remembered across messages. Use concise, user-facing titles.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short description of the task" },
          status: {
            type: "string",
            description: "Initial status for the task",
            enum: ["pending", "in_progress", "completed", "cancelled"],
          },
          metadata: {
            type: "object",
            description: "Optional extra structured information about the task (e.g. source, notes, priority).",
          },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_update",
      description:
        "Update an existing persistent assistant task (for example, mark it completed, change the title, or attach metadata).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the task to update (from task_list/task_create results)" },
          title: { type: "string", description: "New title, if you want to rename the task" },
          status: {
            type: "string",
            description: "New status for the task",
            enum: ["pending", "in_progress", "completed", "cancelled"],
          },
          metadata: {
            type: "object",
            description: "Partial metadata to merge into the existing task metadata.",
          },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_delete",
      description: "Delete a persistent assistant task by ID when it is no longer relevant.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the task to delete (from task_list/task_create results)" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "task_clear_completed",
      description: "Remove all tasks that are already completed or cancelled to keep the task list tidy.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_set_fact",
      description:
        "Store a stable user fact or preference in persistent memory (for example, favorite language, tools, or long-term goals).",
      parameters: {
        type: "object",
        properties: {
          key: { type: "string", description: "Short key/name for the fact (e.g. 'favorite_language')" },
          value: { type: "string", description: "Text value to remember for this key" },
        },
        required: ["key", "value"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_list_facts",
      description: "List all stored persistent user facts and preferences.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_search_conversations",
      description:
        "Search across the full chat history (all conversations) for a free-text query and return matching conversations and message snippets.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query text" },
        },
        required: ["query"],
      },
    },
  },
];

export function createOpenAIProvider(apiKey: string, model: string): ChatProvider {
  return {
    id: "openai",
    async *sendMessage(messages: ChatMessage[]) {
      const client = new OpenAI({ apiKey });
      const stream = await client.chat.completions.create({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) yield delta.content;
      }
    },
  };
}

type ChatCompletionMessage = OpenAI.Chat.Completions.ChatCompletionMessage;
type ChatCompletionChunk = OpenAI.Chat.Completions.ChatCompletionChunk;

function mergeDelta(acc: Record<string, unknown>, delta: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(delta)) {
    if (value === undefined || value === null) continue;
    if (acc[key] === undefined || acc[key] === null) {
      acc[key] = value;
    } else if (typeof acc[key] === "string" && typeof value === "string") {
      acc[key] = (acc[key] as string) + value;
    } else if (Array.isArray(value)) {
      const accArray = (acc[key] as Record<string, unknown>[]) ?? [];
      for (const item of value as Array<Record<string, unknown> & { index?: number }>) {
        const { index, ...rest } = item;
        const idx = index ?? accArray.length;
        if (!accArray[idx]) accArray[idx] = {};
        mergeDelta(accArray[idx] as Record<string, unknown>, rest);
      }
      acc[key] = accArray;
    } else if (typeof value === "object" && value !== null) {
      mergeDelta((acc[key] ?? {}) as Record<string, unknown>, value as Record<string, unknown>);
    }
  }
}

function messageReducer(
  previous: Partial<ChatCompletionMessage>,
  chunk: ChatCompletionChunk
): Partial<ChatCompletionMessage> {
  const choice = chunk.choices[0];
  if (!choice?.delta) return previous;

  const acc = { ...previous } as Record<string, unknown>;
  const delta = choice.delta as Record<string, unknown>;
  mergeDelta(acc, delta);
  return acc as Partial<ChatCompletionMessage>;
}

export async function sendMessageWithTools(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  const client = new OpenAI({ apiKey });
  const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map((m) => ({ role: m.role, content: m.content }));

  async function* run(): AsyncGenerator<string> {
    while (true) {
      const stream = await client.chat.completions.create(
        {
          model,
          messages: currentMessages,
          stream: true,
          tools: TOOL_DEFINITIONS,
          tool_choice: "auto",
        },
        { signal }
      );

      let message: Partial<ChatCompletionMessage> = {};
      for await (const chunk of stream) {
        message = messageReducer(message, chunk);
        const delta = chunk.choices[0]?.delta?.content;
        if (delta) yield delta;
      }

      const toolCalls = (message as { tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }).tool_calls;
      if (!toolCalls?.length) break;

      // API requires each 'tool' message to follow the assistant message that had tool_calls
      currentMessages.push({
        role: "assistant",
        content: (message as { content?: string | null }).content ?? null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id ?? "",
          type: "function" as const,
          function: {
            name: tc.function?.name ?? "",
            arguments: tc.function?.arguments ?? "{}",
          },
        })),
      } as OpenAI.Chat.Completions.ChatCompletionMessageParam);

      for (const tc of toolCalls) {
        const name = tc.function?.name ?? "";
        const args = JSON.parse(tc.function?.arguments ?? "{}") as Record<string, unknown>;
        const result = await executeTool(name, args);
        currentMessages.push({
          role: "tool",
          tool_call_id: tc.id ?? "",
          content: result,
        } as OpenAI.Chat.Completions.ChatCompletionMessageParam);
      }
    }
  }

  return run();
}
