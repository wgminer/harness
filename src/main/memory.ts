import { ipcMain } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { ChatMessage, SearchResult } from "../shared/types";

const MEMORY_DIR = "memory";
const CONVERSATIONS_FILE = "conversations.json";
const USER_MEMORY_FILE = "user_memory.json";

function getMemoryDir(): string {
  const dir = join(app.getPath("userData"), MEMORY_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Stored per-conversation; optional isFromChatGPT/chatgptId used for ChatGPT import dedupe. */
interface ConversationMeta {
  title: string | null;
  createdAt: number;
  isFromChatGPT?: boolean;
  chatgptId?: string;
}

interface MessageRecord {
  role: string;
  content: string;
  toolCalls?: Array<{ toolName: string; payload?: unknown }>;
}

function loadConversations(): Record<string, ConversationMeta> {
  const path = join(getMemoryDir(), CONVERSATIONS_FILE);
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return data;
}

function saveConversations(conv: Record<string, ConversationMeta>): void {
  const path = join(getMemoryDir(), CONVERSATIONS_FILE);
  writeFileSync(path, JSON.stringify(conv, null, 2), "utf-8");
}

function getMessagesPath(conversationId: string): string {
  return join(getMemoryDir(), `messages_${conversationId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

function loadMessages(conversationId: string): MessageRecord[] {
  const path = getMessagesPath(conversationId);
  if (!existsSync(path)) return [];
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return Array.isArray(data) ? data : [];
}

function saveMessages(conversationId: string, messages: MessageRecord[]): void {
  const path = getMessagesPath(conversationId);
  writeFileSync(path, JSON.stringify(messages, null, 2), "utf-8");
}

function createConversation(): string {
  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const conv = loadConversations();
  conv[id] = { title: null, createdAt: Date.now() };
  saveConversations(conv);
  saveMessages(id, []);
  return id;
}

function getConversation(id: string): { id: string; title: string | null; createdAt: number } | null {
  const conv = loadConversations();
  const c = conv[id];
  if (!c) return null;
  return { id, title: c.title, createdAt: c.createdAt };
}

function listConversations(): { id: string; title: string | null; createdAt: number }[] {
  const conv = loadConversations();
  return Object.entries(conv)
    .map(([id, c]) => ({ id, title: c.title, createdAt: c.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function getExistingChatgptIds(): string[] {
  const conv = loadConversations();
  const ids: string[] = [];
  for (const c of Object.values(conv)) {
    if (c.isFromChatGPT === true && typeof c.chatgptId === "string" && c.chatgptId) {
      ids.push(c.chatgptId);
    }
  }
  return ids;
}

export interface ImportConversationItem {
  title: string | null;
  createdAt: number;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  chatgptId?: string;
}

function importConversations(items: ImportConversationItem[]): { imported: number; ids: string[] } {
  const conv = loadConversations();
  const ids: string[] = [];
  for (const item of items) {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const meta: ConversationMeta = {
      title: item.title,
      createdAt: item.createdAt,
    };
    if (item.chatgptId != null) {
      meta.isFromChatGPT = true;
      meta.chatgptId = item.chatgptId;
    }
    conv[id] = meta;
    const messages: MessageRecord[] = item.messages.map((m) => ({ role: m.role, content: m.content }));
    saveMessages(id, messages);
    ids.push(id);
  }
  saveConversations(conv);
  return { imported: ids.length, ids };
}

function deleteConversation(conversationId: string): void {
  const conv = loadConversations();
  if (!(conversationId in conv)) return;
  delete conv[conversationId];
  saveConversations(conv);
  const messagesPath = getMessagesPath(conversationId);
  if (existsSync(messagesPath)) unlinkSync(messagesPath);
}

/** Clears all conversations and their message files. Use to reset history (e.g. undo import). */
function resetHistory(): void {
  const dir = getMemoryDir();
  const conv = loadConversations();
  for (const id of Object.keys(conv)) {
    const path = getMessagesPath(id);
    if (existsSync(path)) unlinkSync(path);
  }
  saveConversations({});
}

function getMessages(conversationId: string): ChatMessage[] {
  const rows = loadMessages(conversationId);
  return rows.map((r) => {
    const msg: ChatMessage = { role: r.role as ChatMessage["role"], content: r.content };
    if (r.toolCalls?.length) msg.toolCalls = r.toolCalls;
    return msg;
  });
}

function appendMessage(
  conversationId: string,
  role: ChatMessage["role"],
  content: string,
  options?: { toolCalls?: Array<{ toolName: string; payload?: unknown }> }
): void {
  const messages = loadMessages(conversationId);
  const record: MessageRecord = { role, content };
  if (options?.toolCalls?.length) record.toolCalls = options.toolCalls;
  messages.push(record);
  saveMessages(conversationId, messages);
}

function getUserMemory(): Record<string, string> {
  const path = join(getMemoryDir(), USER_MEMORY_FILE);
  if (!existsSync(path)) return {};
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return typeof data === "object" && data !== null ? data : {};
}

function setUserMemory(key: string, value: string): void {
  const mem = getUserMemory();
  mem[key] = value;
  const path = join(getMemoryDir(), USER_MEMORY_FILE);
  writeFileSync(path, JSON.stringify(mem, null, 2), "utf-8");
}

const SNIPPET_CHARS_BEFORE = 80;
const SNIPPET_CHARS_AFTER = 120;
const SNIPPET_MAX_LINES = 3;

function extractSnippet(content: string, queryLower: string, matchIndex: number): { snippet: string; snippetMatchRange: [number, number] } {
  const windowStart = Math.max(0, matchIndex - SNIPPET_CHARS_BEFORE);
  const matchEndInContent = matchIndex + queryLower.length;
  const windowEnd = Math.min(content.length, matchEndInContent + SNIPPET_CHARS_AFTER);
  let snippetStart = windowStart;
  let snippetEnd = windowEnd;
  const lastNewlineBefore = content.lastIndexOf("\n", matchIndex);
  if (lastNewlineBefore >= 0 && lastNewlineBefore >= windowStart) {
    snippetStart = lastNewlineBefore + 1;
  }
  const nextNewlineAfter = content.indexOf("\n", matchEndInContent);
  if (nextNewlineAfter >= 0 && nextNewlineAfter <= windowEnd) {
    snippetEnd = nextNewlineAfter + 1;
  }
  let lineCount = 1;
  for (let i = snippetStart; i < snippetEnd && lineCount < SNIPPET_MAX_LINES; i++) {
    if (content[i] === "\n") lineCount++;
  }
  if (lineCount >= SNIPPET_MAX_LINES) {
    const secondNewline = content.indexOf("\n", content.indexOf("\n", snippetStart) + 1);
    if (secondNewline >= 0 && secondNewline < snippetEnd) {
      snippetEnd = secondNewline + 1;
    }
  }
  const snippet = content.slice(snippetStart, snippetEnd);
  const matchStartInSnippet = matchIndex - snippetStart;
  const matchEndInSnippet = matchStartInSnippet + queryLower.length;
  const clampedStart = Math.max(0, Math.min(matchStartInSnippet, snippet.length));
  const clampedEnd = Math.max(clampedStart, Math.min(matchEndInSnippet, snippet.length));
  return { snippet, snippetMatchRange: [clampedStart, clampedEnd] };
}

function searchConversations(query: string): SearchResult[] {
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) return [];
  const conv = loadConversations();
  const results: SearchResult[] = [];
  for (const [id, { title, createdAt }] of Object.entries(conv)) {
    const titleStr = title ?? "";
    const titleMatched = titleStr.toLowerCase().includes(q);
    let titleMatchRange: [number, number] | undefined;
    if (titleMatched) {
      const idx = titleStr.toLowerCase().indexOf(q);
      titleMatchRange = [idx, idx + q.length];
    }
    const messages = loadMessages(id);
    let snippet = "";
    let snippetMatchRange: [number, number] = [-1, -1];
    let contentMatched = false;
    for (const msg of messages) {
      const lower = msg.content.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx >= 0) {
        contentMatched = true;
        const extracted = extractSnippet(msg.content, q, idx);
        snippet = extracted.snippet;
        snippetMatchRange = extracted.snippetMatchRange;
        break;
      }
    }
    if (!titleMatched && !contentMatched) continue;
    if (!contentMatched) {
      const first = messages[0]?.content ?? "";
      const lines = first.split("\n").slice(0, SNIPPET_MAX_LINES);
      snippet = lines.join("\n").trim() || "No message content";
      snippetMatchRange = [-1, -1];
    }
    results.push({
      id,
      title: titleStr || null,
      createdAt,
      titleMatched: !!titleMatched,
      titleMatchRange,
      snippet,
      snippetMatchRange,
    });
  }
  results.sort((a, b) => b.createdAt - a.createdAt);
  return results;
}

export function registerMemoryHandlers(): void {
  ipcMain.handle("memory:createConversation", () => createConversation());
  ipcMain.handle("memory:getConversation", (_e, id: string) => getConversation(id));
  ipcMain.handle("memory:listConversations", () => listConversations());
  ipcMain.handle("memory:getMessages", (_e, conversationId: string) => getMessages(conversationId));
  ipcMain.handle(
    "memory:appendMessage",
    (_e, conversationId: string, role: ChatMessage["role"], content: string, toolCalls?: Array<{ toolName: string; payload?: unknown }>) =>
      appendMessage(conversationId, role, content, toolCalls?.length ? { toolCalls } : undefined)
  );
  ipcMain.handle("memory:getUserMemory", () => getUserMemory());
  ipcMain.handle("memory:setUserMemory", (_e, key: string, value: string) => setUserMemory(key, value));
  ipcMain.handle("memory:deleteConversation", (_e, conversationId: string) => deleteConversation(conversationId));
  ipcMain.handle("memory:searchConversations", (_e, query: string) => searchConversations(query));
  ipcMain.handle("memory:resetHistory", () => resetHistory());
}

export {
  getMessages,
  getUserMemory,
  setUserMemory,
  appendMessage,
  getConversation,
  createConversation,
  getExistingChatgptIds,
  importConversations,
  searchConversations,
};
