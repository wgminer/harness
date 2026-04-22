import OpenAI from "openai";
import type { ChatMessage } from "../../shared/types";
import { OPENAI_CHAT_MODEL, OPENAI_TITLE_MODEL } from "../../shared/openaiModels";
import { recordOpenAIUsage } from "../usageStats";
import type { LLMProvider } from "./types";
import { TOOL_DEFINITIONS } from "./toolDefinitions";

export async function generateThreadTitleWithOpenAI(
  apiKey: string,
  previousTitle: string | null,
  context: string
): Promise<string | null> {
  const client = new OpenAI({ apiKey });
  const system =
    "You name chat threads for a sidebar. Reply with a short, descriptive title (a few words). " +
    "No quotes or extra punctuation. " +
    "If the previous title still fits the recent conversation, reply with exactly: UNCHANGED";

  const userBlock = [
    previousTitle ? `Previous title: ${previousTitle}` : "Previous title: (none)",
    "",
    "Recent conversation:",
    context,
  ].join("\n");

  const completion = await client.chat.completions.create(
    {
      model: OPENAI_TITLE_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userBlock },
      ],
      max_completion_tokens: 512,
      reasoning_effort: "low",
    },
    { signal: AbortSignal.timeout(10_000) }
  );

  if (completion.usage) {
    recordOpenAIUsage(completion.usage);
  }

  const raw = completion.choices[0]?.message?.content?.trim() ?? "";
  if (!raw) return null;
  if (/^UNCHANGED$/i.test(raw)) return null;
  return raw;
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

export function createOpenAIProvider(apiKey: string): LLMProvider {
  const client = new OpenAI({ apiKey });
  const model = OPENAI_CHAT_MODEL;

  return {
    id: "openai",

    async sendMessageWithTools(
      messages: ChatMessage[],
      executeTool: (name: string, args: Record<string, unknown>) => Promise<string>,
      signal?: AbortSignal
    ): Promise<AsyncIterable<string>> {
      const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      async function* run(): AsyncGenerator<string> {
        while (true) {
          const stream = await client.chat.completions.create(
            {
              model,
              messages: currentMessages,
              stream: true,
              stream_options: { include_usage: true },
              tools: TOOL_DEFINITIONS,
              tool_choice: "auto",
            },
            { signal }
          );

          let message: Partial<ChatCompletionMessage> = {};
          for await (const chunk of stream) {
            if (chunk.usage) {
              recordOpenAIUsage(chunk.usage);
            }
            message = messageReducer(message, chunk);
            const delta = chunk.choices[0]?.delta?.content;
            if (delta) yield delta;
          }

          const toolCalls = (
            message as { tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }
          ).tool_calls;
          if (!toolCalls?.length) break;

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
    },

    async generateTitle(
      previousTitle: string | null,
      context: string,
      _model: string
    ): Promise<string | null> {
      return generateThreadTitleWithOpenAI(apiKey, previousTitle, context);
    },
  };
}
