import { DICTATION_POLISH_INSTRUCTION } from "../../shared/dictationPolish";
import { shouldRefineConversationTitle } from "../../shared/conversationTitlePolicy";
import { emitBrowserEvent } from "./browserEvents";
import { buildChatRequestMessages } from "./browserPrompt";
import type { BrowserStore } from "./browserStore";

const OPENAI_CHAT_URL = "/openai/v1/chat/completions";
const FALLBACK_TITLE_MAX_CHARS = 60;

export function browserChatModel(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_OPENAI_CHAT_MODEL?.trim() || "gpt-5.4";
}

export function browserTitleModel(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_OPENAI_TITLE_MODEL?.trim() || "gpt-5.4-nano";
}

export function consumeSseBuffer(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;
  let pos = rest.indexOf("\n\n");
  while (pos >= 0) {
    events.push(rest.slice(0, pos));
    rest = rest.slice(pos + 2);
    pos = rest.indexOf("\n\n");
  }
  return { events, rest };
}

export function extractDeltaContent(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const choices = (parsed as { choices?: Array<{ delta?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.delta?.content;
  return typeof content === "string" ? content : "";
}

function cleanTitle(raw: string): string {
  return raw.replace(/["'`]/g, "").split(/\s+/).filter(Boolean).join(" ").trim();
}

export function fallbackTitleFromMessages(messages: Array<{ role: string; content: string }>): string | null {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return null;
  const cleaned = cleanTitle(firstUser.content);
  if (!cleaned) return null;
  if ([...cleaned].length <= FALLBACK_TITLE_MAX_CHARS) return cleaned;
  const words = cleaned.split(" ");
  let truncated = "";
  for (const word of words) {
    const next = truncated ? `${truncated} ${word}` : word;
    if ([...next].length > FALLBACK_TITLE_MAX_CHARS) break;
    truncated = next;
  }
  return truncated || [...cleaned].slice(0, FALLBACK_TITLE_MAX_CHARS).join("");
}

async function readErrorDetail(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // use raw text
  }
  return text.slice(0, 400);
}

export async function streamOpenAiChat(input: {
  apiKey: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  signal: AbortSignal;
  onChunk: (chunk: string) => void;
}): Promise<string> {
  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      stream: true,
    }),
    signal: input.signal,
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response));
  }
  if (!response.body) {
    throw new Error("OpenAI stream had no body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const consumed = consumeSseBuffer(buffer);
    buffer = consumed.rest;
    for (const event of consumed.events) {
      for (const line of event.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return full;
        try {
          const parsed = JSON.parse(data) as unknown;
          const chunk = extractDeltaContent(parsed);
          if (chunk) {
            full += chunk;
            input.onChunk(chunk);
          }
        } catch {
          // ignore malformed SSE frames
        }
      }
    }
  }
  return full;
}

async function completeTitle(apiKey: string, messages: Array<{ role: string; content: string }>): Promise<string | null> {
  const userTurns = messages.filter((m) => m.role === "user").slice(0, 4);
  const assistantTurns = messages.filter((m) => m.role === "assistant").slice(0, 2);
  const prompt = [...userTurns, ...assistantTurns]
    .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
    .join("\n\n");
  const response = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: browserTitleModel(),
      messages: [
        {
          role: "system",
          content: "Write a short conversation title. Max 8 words. No quotes or trailing punctuation.",
        },
        { role: "user", content: prompt || "Untitled chat" },
      ],
      stream: false,
    }),
  });
  if (!response.ok) return null;
  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const cleaned = cleanTitle(raw);
  return cleaned || null;
}

export function createBrowserChat(store: BrowserStore) {
  let abort: AbortController | null = null;

  const requireKey = () => {
    const key = store.secrets().openaiApiKey.trim();
    if (!key) throw new Error("OpenAI API key required.");
    return key;
  };

  const refineTitle = async (conversationId: string) => {
    const conv = store.conversation(conversationId);
    if (!conv) return;
    if (!shouldRefineConversationTitle(conv.messages, conv.title)) return;
    emitBrowserEvent("chat:titleGenerationStarted", { conversationId });
    try {
      const apiKey = store.secrets().openaiApiKey.trim();
      let title: string | null = null;
      if (apiKey) {
        try {
          title = await completeTitle(apiKey, conv.messages);
        } catch {
          title = null;
        }
      }
      title = title || fallbackTitleFromMessages(conv.messages);
      if (title) store.setConversationTitle(conversationId, title);
    } finally {
      emitBrowserEvent("chat:conversationTitleUpdated", { conversationId });
      emitBrowserEvent("chat:titleGenerationEnded", { conversationId });
    }
  };

  const streamAssistant = async (conversationId: string, extraUser?: string[]) => {
    const apiKey = requireKey();
    abort?.abort();
    abort = new AbortController();
    const signal = abort.signal;
    const { messages } = buildChatRequestMessages(store, conversationId, extraUser);
    const model = browserChatModel();
    let content = "";
    try {
      content = await streamOpenAiChat({
        apiKey,
        model,
        messages,
        signal,
        onChunk: (chunk) => {
          emitBrowserEvent("chat:streamChunk", { conversationId, chunk });
        },
      });
      if (content.trim()) {
        store.appendMessage(conversationId, "assistant", content, {
          timestamp: Date.now(),
          model,
        });
      }
    } catch (err) {
      if (signal.aborted) {
        if (content.trim()) {
          store.appendMessage(conversationId, "assistant", content, {
            timestamp: Date.now(),
            model,
          });
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        store.appendMessage(conversationId, "assistant", `[Error: ${message}]`, {
          timestamp: Date.now(),
          model,
        });
      }
    } finally {
      emitBrowserEvent("chat:streamEnd", { conversationId });
      if (abort?.signal === signal) abort = null;
    }
    void refineTitle(conversationId);
  };

  return {
    async send(conversationId: string, userContent: string): Promise<void> {
      store.appendMessage(conversationId, "user", userContent, { timestamp: Date.now() });
      void refineTitle(conversationId);
      await streamAssistant(conversationId);
    },
    async generateReply(conversationId: string): Promise<void> {
      await streamAssistant(conversationId);
    },
    async polishLastUser(conversationId: string): Promise<void> {
      const transcript = store.popLastUserMessage(conversationId);
      if (transcript == null) throw new Error("No user message to polish.");
      const t1 = Date.now();
      store.appendMessage(conversationId, "user", DICTATION_POLISH_INSTRUCTION, { timestamp: t1 });
      store.appendMessage(conversationId, "user", transcript, { timestamp: t1 + 1 });
      void refineTitle(conversationId);
      await streamAssistant(conversationId);
    },
    async stop(): Promise<void> {
      abort?.abort();
      abort = null;
    },
  };
}
