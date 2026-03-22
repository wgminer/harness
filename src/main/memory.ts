import { ipcMain } from "electron";
import { readFile, writeFile, access, mkdir, unlink } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { AppendMessageMeta, ChatMessage, SearchResult } from "../shared/types";
import { notifyConversationTitleUpdated } from "./titleEvents";
import { generateId } from "./utils";

const MEMORY_DIR = "memory";
const CONVERSATIONS_FILE = "conversations.json";
const USER_MEMORY_FILE = "user_memory.json";
export const TASKS_FILE = "tasks.json";
export const PLANS_FILE = "plans.json";

export function getMemoryDir(): string {
  const dir = join(app.getPath("userData"), MEMORY_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Stored per-conversation; optional isFromChatGPT/chatgptId used for ChatGPT import dedupe. */
export type ConversationTitleSource = "auto" | "user" | "imported";

export interface ConversationMeta {
  title: string | null;
  createdAt: number;
  isFromChatGPT?: boolean;
  chatgptId?: string;
  titleSource?: ConversationTitleSource;
}

interface MessageRecord {
  role: string;
  content: string;
  toolCalls?: Array<{ toolName: string; payload?: unknown }>;
  timestamp?: number;
  model?: string;
}


async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function loadConversations(): Promise<Record<string, ConversationMeta>> {
  const path = join(getMemoryDir(), CONVERSATIONS_FILE);
  if (!(await fileExists(path))) return {};
  return JSON.parse(await readFile(path, "utf-8"));
}

async function saveConversations(conv: Record<string, ConversationMeta>): Promise<void> {
  await writeFile(join(getMemoryDir(), CONVERSATIONS_FILE), JSON.stringify(conv, null, 2), "utf-8");
}

function getMessagesPath(conversationId: string): string {
  return join(getMemoryDir(), `messages_${conversationId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

async function loadMessages(conversationId: string): Promise<MessageRecord[]> {
  const path = getMessagesPath(conversationId);
  if (!(await fileExists(path))) return [];
  const data = JSON.parse(await readFile(path, "utf-8"));
  return Array.isArray(data) ? data : [];
}

async function saveMessages(conversationId: string, messages: MessageRecord[]): Promise<void> {
  await writeFile(getMessagesPath(conversationId), JSON.stringify(messages, null, 2), "utf-8");
}

async function createConversation(): Promise<string> {
  const id = generateId("conv");
  const conv = await loadConversations();
  conv[id] = { title: null, createdAt: Date.now() };
  await saveConversations(conv);
  await saveMessages(id, []);
  return id;
}

async function getConversation(id: string): Promise<{ id: string; title: string | null; createdAt: number } | null> {
  const conv = await loadConversations();
  const c = conv[id];
  if (!c) return null;
  return { id, title: c.title, createdAt: c.createdAt };
}

export async function getConversationMetaForId(conversationId: string): Promise<ConversationMeta | null> {
  const conv = await loadConversations();
  const c = conv[conversationId];
  return c ? { ...c } : null;
}

export async function patchConversationMeta(conversationId: string, patch: Partial<ConversationMeta>): Promise<void> {
  const conv = await loadConversations();
  const c = conv[conversationId];
  if (!c) return;
  Object.assign(c, patch);
  await saveConversations(conv);
}

async function setConversationTitle(
  conversationId: string,
  title: string,
  source: ConversationTitleSource = "user"
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  await patchConversationMeta(conversationId, { title: trimmed, titleSource: source });
}

/** Placeholder title for voice-dictation threads; `titleSource: "auto"` so LLM refinement can replace it. */
export async function setVoiceDictationTitle(conversationId: string): Promise<string> {
  const time = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const title = `Voice Dictation ${time}`;
  await patchConversationMeta(conversationId, { title, titleSource: "auto" });
  notifyConversationTitleUpdated(conversationId);
  return title;
}

async function listConversations(): Promise<{ id: string; title: string | null; createdAt: number }[]> {
  const conv = await loadConversations();
  return Object.entries(conv)
    .map(([id, c]) => ({ id, title: c.title, createdAt: c.createdAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

async function getExistingChatgptIds(): Promise<string[]> {
  const conv = await loadConversations();
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

async function importConversations(items: ImportConversationItem[]): Promise<{ imported: number; ids: string[] }> {
  const conv = await loadConversations();
  const ids: string[] = [];
  for (const item of items) {
    const id = generateId("conv");
    const meta: ConversationMeta = {
      title: item.title,
      createdAt: item.createdAt,
      ...(item.title ? { titleSource: "imported" as const } : {}),
    };
    if (item.chatgptId != null) {
      meta.isFromChatGPT = true;
      meta.chatgptId = item.chatgptId;
    }
    conv[id] = meta;
    const messages: MessageRecord[] = item.messages.map((m) => ({ role: m.role, content: m.content }));
    await saveMessages(id, messages);
    ids.push(id);
  }
  await saveConversations(conv);
  return { imported: ids.length, ids };
}

async function deleteConversation(conversationId: string): Promise<void> {
  const conv = await loadConversations();
  if (!(conversationId in conv)) return;
  delete conv[conversationId];
  await saveConversations(conv);
  const messagesPath = getMessagesPath(conversationId);
  if (await fileExists(messagesPath)) await unlink(messagesPath);
}

async function resetStoredData(): Promise<void> {
  const dir = getMemoryDir();
  const conv = await loadConversations();
  for (const id of Object.keys(conv)) {
    const path = getMessagesPath(id);
    if (await fileExists(path)) await unlink(path);
  }
  await saveConversations({});

  const userMemPath = join(dir, USER_MEMORY_FILE);
  if (await fileExists(userMemPath)) await unlink(userMemPath);

  const tasksPath = join(dir, TASKS_FILE);
  if (await fileExists(tasksPath)) await unlink(tasksPath);

  const plansPath = join(dir, PLANS_FILE);
  if (await fileExists(plansPath)) await unlink(plansPath);
}

async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const rows = await loadMessages(conversationId);
  return rows.map((r) => {
    const msg: ChatMessage = { role: r.role as ChatMessage["role"], content: r.content };
    if (r.toolCalls?.length) msg.toolCalls = r.toolCalls;
    if (typeof r.timestamp === "number") msg.timestamp = r.timestamp;
    if (typeof r.model === "string" && r.model) msg.model = r.model;
    return msg;
  });
}

async function appendMessage(
  conversationId: string,
  role: ChatMessage["role"],
  content: string,
  options?: AppendMessageMeta
): Promise<void> {
  const messages = await loadMessages(conversationId);
  const record: MessageRecord = { role, content };
  if (options?.toolCalls?.length) record.toolCalls = options.toolCalls;
  if (typeof options?.timestamp === "number") record.timestamp = options.timestamp;
  if (typeof options?.model === "string" && options.model) record.model = options.model;
  messages.push(record);
  await saveMessages(conversationId, messages);
}

async function getUserMemory(): Promise<Record<string, string>> {
  const path = join(getMemoryDir(), USER_MEMORY_FILE);
  if (!(await fileExists(path))) return {};
  const data = JSON.parse(await readFile(path, "utf-8"));
  return typeof data === "object" && data !== null ? data : {};
}

async function setUserMemory(key: string, value: string): Promise<void> {
  const mem = await getUserMemory();
  mem[key] = value;
  await writeFile(join(getMemoryDir(), USER_MEMORY_FILE), JSON.stringify(mem, null, 2), "utf-8");
}

async function deleteUserMemoryKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) return;
  const mem = await getUserMemory();
  if (!(trimmed in mem)) return;
  delete mem[trimmed];
  const path = join(getMemoryDir(), USER_MEMORY_FILE);
  if (Object.keys(mem).length === 0) {
    if (await fileExists(path)) await unlink(path);
  } else {
    await writeFile(path, JSON.stringify(mem, null, 2), "utf-8");
  }
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

async function searchConversations(query: string): Promise<SearchResult[]> {
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) return [];
  const conv = await loadConversations();
  const results: SearchResult[] = [];
  for (const [id, { title, createdAt }] of Object.entries(conv)) {
    const titleStr = title ?? "";
    const titleMatched = titleStr.toLowerCase().includes(q);
    let titleMatchRange: [number, number] | undefined;
    if (titleMatched) {
      const idx = titleStr.toLowerCase().indexOf(q);
      titleMatchRange = [idx, idx + q.length];
    }
    const messages = await loadMessages(id);
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
    (_e, conversationId: string, role: ChatMessage["role"], content: string, meta?: AppendMessageMeta) =>
      appendMessage(conversationId, role, content, meta)
  );
  ipcMain.handle("memory:getUserMemory", () => getUserMemory());
  ipcMain.handle("memory:setUserMemory", (_e, key: string, value: string) => setUserMemory(key, value));
  ipcMain.handle("memory:deleteUserMemoryKey", (_e, key: string) => deleteUserMemoryKey(key));
  ipcMain.handle("memory:deleteConversation", (_e, conversationId: string) => deleteConversation(conversationId));
  ipcMain.handle("memory:searchConversations", (_e, query: string) => searchConversations(query));
  ipcMain.handle("memory:resetStoredData", () => resetStoredData());
  ipcMain.handle("memory:setConversationTitle", async (_e, conversationId: string, title: string) => {
    await setConversationTitle(conversationId, title, "user");
    notifyConversationTitleUpdated(conversationId);
  });
  ipcMain.handle("memory:setVoiceDictationTitle", (_e, conversationId: string) => setVoiceDictationTitle(conversationId));
}

export {
  getMessages,
  getUserMemory,
  setUserMemory,
  deleteUserMemoryKey,
  appendMessage,
  getConversation,
  createConversation,
  getExistingChatgptIds,
  importConversations,
  searchConversations,
  setConversationTitle,
};
