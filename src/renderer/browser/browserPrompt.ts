import toolsContract from "../../../resources/contracts/tools.json";
import { chatModeOverlay, getChatMode } from "../../shared/chatModes";
import { conversationDisplayTitle } from "../../shared/conversationSession";
import { formatMemoryContextBlock, sortedMemoryEntries } from "../../shared/memoryInjection";
import {
  applyTotalBodyBudget,
  cleanDialogueBody,
} from "../../shared/recentConversations";
import {
  assembleStaticSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
} from "../../shared/systemPromptDefaults";
import {
  annotateMessageContentForModel,
  formatTemporalContextBlock,
} from "../../shared/chatTemporalContext";
import type {
  ContextPreview,
  ContextPreviewMessage,
  ContextPreviewTool,
  SystemPromptPreview,
  SystemPromptPreviewTool,
} from "../../shared/types";
import type { BrowserConversation, BrowserStore } from "./browserStore";

type ChatRequestMessage = { role: string; content: string };

function toolSummaries(): ContextPreviewTool[] {
  const tools = toolsContract as Array<{
    function?: { name?: string; description?: string };
  }>;
  return tools
    .map((tool) => ({
      name: tool.function?.name ?? "",
      description: tool.function?.description ?? "",
    }))
    .filter((tool) => tool.name);
}

function systemPromptPreviewTools(): SystemPromptPreviewTool[] {
  return toolSummaries();
}

export function buildRecentConversationsBlock(
  conversations: BrowserConversation[],
  excludeId?: string | null,
  now = Date.now(),
): string {
  const candidates = conversations
    .filter((c) => c.id !== excludeId && c.hasMessages && c.messages.length > 0)
    .map((c) => ({
      title: conversationDisplayTitle(c.title, c.createdAt),
      activityAt: Math.max(c.createdAt, ...c.messages.map((m) => m.timestamp ?? 0)),
      body: cleanDialogueBody(c.messages),
    }))
    .filter((c) => c.body.trim().length > 0)
    .sort((a, b) => b.activityAt - a.activityAt)
    .slice(0, 5);
  if (candidates.length === 0) return "";

  const bodies = applyTotalBodyBudget(candidates.map((c) => c.body));
  const lines = [
    "[RECENT_CONVERSATIONS]",
    "Other recent chats for continuity (newest first). Bodies may be truncated.",
    "",
  ];
  candidates.forEach((entry, index) => {
    const body = bodies[index];
    if (!body?.trim()) return;
    const minutes = Math.max(0, Math.round((now - entry.activityAt) / 60_000));
    const relative =
      minutes < 1 ? "just now" : minutes < 60 ? `${minutes} minute${minutes === 1 ? "" : "s"} ago` : `${Math.round(minutes / 60)} hours ago`;
    lines.push(`--- ${entry.title}`);
    lines.push(`Last active: ${new Date(entry.activityAt).toLocaleString()} (${relative})`);
    lines.push("");
    lines.push(body);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

export function assembleBrowserSystemPrompt(input: {
  store: BrowserStore;
  conversationId?: string | null;
  platform?: "desktop" | "ios";
  chatMode?: string;
}): {
  systemPrompt: string;
  memoryBlock: string;
  recentConversationsBlock: string;
  temporalContext: string;
  selectedMemories: Array<[string, string]>;
  modeOverlay: string;
  chatMode: string;
  staticPrompt: string;
  platformOverlay: string;
} {
  const platform = input.platform === "ios" ? "ios" : "desktop";
  const conversation = input.conversationId ? input.store.conversation(input.conversationId) : undefined;
  const chatMode = platform === "ios" ? "chat" : getChatMode(input.chatMode ?? conversation?.chatMode).id;
  const modeOverlay = platform === "ios" ? "" : chatModeOverlay(chatMode) ?? "";
  const selectedMemories = sortedMemoryEntries(input.store.userMemory());
  const memoryBlock = formatMemoryContextBlock(selectedMemories);
  const recentConversationsBlock = buildRecentConversationsBlock(
    input.store.conversations(),
    input.conversationId,
  );
  const temporalContext = formatTemporalContextBlock();
  const staticPrompt = assembleStaticSystemPrompt(DEFAULT_SYSTEM_PROMPT, platform);
  const platformOverlay = platform === "ios" ? DEFAULT_SYSTEM_PROMPT.ios : DEFAULT_SYSTEM_PROMPT.desktop;
  const parts = [staticPrompt];
  if (modeOverlay.trim()) parts.push(modeOverlay.trim());
  if (memoryBlock) parts.push(memoryBlock);
  if (recentConversationsBlock) parts.push(recentConversationsBlock);
  parts.push(temporalContext);
  return {
    systemPrompt: parts.join("\n\n"),
    memoryBlock,
    recentConversationsBlock,
    temporalContext,
    selectedMemories,
    modeOverlay,
    chatMode,
    staticPrompt,
    platformOverlay,
  };
}

export function buildChatRequestMessages(
  store: BrowserStore,
  conversationId: string,
  extraUser?: string[],
): { assembly: ReturnType<typeof assembleBrowserSystemPrompt>; messages: ChatRequestMessage[] } {
  const assembly = assembleBrowserSystemPrompt({ store, conversationId });
  const history = store.conversation(conversationId)?.messages ?? [];
  const now = Date.now();
  const messages: ChatRequestMessage[] = [
    { role: "system", content: assembly.systemPrompt },
    ...history
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "system")
      .map((m) => ({
        role: m.role,
        content:
          m.role === "system"
            ? m.content
            : annotateMessageContentForModel(m.content, m.timestamp),
      })),
    ...(extraUser ?? []).map((content, index) => ({
      role: "user",
      content: annotateMessageContentForModel(content, now + index),
    })),
  ];
  return { assembly, messages };
}

export function browserSystemPromptPreview(
  store: BrowserStore,
  platform: "desktop" | "ios",
  chatMode?: string,
): SystemPromptPreview {
  const assembled = assembleBrowserSystemPrompt({ store, platform, chatMode });
  return {
    platform,
    shared: DEFAULT_SYSTEM_PROMPT.shared,
    platformOverlay: assembled.platformOverlay,
    staticPrompt: assembled.staticPrompt,
    modeOverlay: assembled.modeOverlay,
    chatMode: assembled.chatMode,
    memoryBlock: assembled.memoryBlock,
    recentConversationsBlock: assembled.recentConversationsBlock,
    temporalContext: assembled.temporalContext,
    assembledPrompt: assembled.systemPrompt,
    selectedMemories: assembled.selectedMemories.map(([key, value]) => ({ key, value })),
    tools: systemPromptPreviewTools(),
  };
}

export function browserContextPreview(
  store: BrowserStore,
  conversationId?: string | null,
): ContextPreview {
  const extra: string[] = [];
  const { assembly, messages } = conversationId
    ? buildChatRequestMessages(store, conversationId, extra)
    : {
        assembly: assembleBrowserSystemPrompt({ store, conversationId }),
        messages: [{ role: "system", content: assembleBrowserSystemPrompt({ store }).systemPrompt }],
      };
  return {
    selectedMemories: assembly.selectedMemories.map(([key, value]) => ({ key, value })),
    systemPrompt: assembly.systemPrompt,
    temporalContext: assembly.temporalContext,
    memoryBlock: assembly.memoryBlock,
    messages: messages
      .filter((m) => m.role !== "system")
      .map((m): ContextPreviewMessage => ({ role: m.role, content: m.content })),
    tools: toolSummaries(),
  };
}
