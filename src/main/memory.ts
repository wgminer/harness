import { ipcMain, shell } from "electron";
import { readFile, writeFile, mkdir, readdir, unlink } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { AppendMessageMeta, ChatMessage, SearchResult } from "../shared/types";
import { scheduleConversationTitleRefinement } from "./conversationTitle";
import { notifyConversationTitleUpdated } from "./titleEvents";
import { readJsonObjectFile, readJsonArrayFile, atomicWriteUtf8 } from "./jsonFile";
import { generateId, fileExists } from "./utils";
import {
  cleanupLegacyMemoryDir,
  getAppStateDir,
  getLegacyMemoryDir,
  getLocalDataDir,
  getLocalDataSettingsPath,
  getLocalDataThemesDir,
  getUserDataDir,
} from "./localDataPaths";
import { getRecordingsDir } from "./recording";
import { getSyncStatus } from "./sync";

const CONVERSATIONS_FILE = "conversations.json";
const USER_MEMORY_FILE = "user_memory.json";
export const TASKS_FILE = "tasks.json";
export const CLIPPINGS_FILE = "clippings.json";
export const PLANS_FILE = "plans.json";

export function getMemoryDir(): string {
  const dir = getAppStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function ensureDir(memoryDir: string): string {
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });
  return memoryDir;
}

function getConversationsPath(memoryDir: string): string {
  return join(memoryDir, CONVERSATIONS_FILE);
}

export function getMessagesPathIn(memoryDir: string, conversationId: string): string {
  return join(memoryDir, `messages_${conversationId.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
}

function getUserMemoryPath(memoryDir: string): string {
  return join(memoryDir, USER_MEMORY_FILE);
}

/** Stored per-conversation; optional isFromChatGPT/chatgptId/claudeId used for import dedupe. */
export type ConversationTitleSource = "auto" | "user" | "imported";

export type ConversationSessionKind = "dictation" | "chat";

export interface ConversationMeta {
  title: string | null;
  createdAt: number;
  isFromChatGPT?: boolean;
  chatgptId?: string;
  isFromClaude?: boolean;
  claudeId?: string;
  titleSource?: ConversationTitleSource;
  /** Voice capture saved as a thread without opening chat first. */
  sessionKind?: ConversationSessionKind;
  /** Set when an assistant message is persisted (dictation → chat). */
  hasAssistantReply?: boolean;
  /** Set when the conversation has at least one persisted message. */
  hasMessages?: boolean;
}

interface MessageRecord {
  role: string;
  content: string;
  toolCalls?: Array<{ toolName: string; payload?: unknown }>;
  timestamp?: number;
  model?: string;
}


export async function loadConversationsIn(memoryDir: string): Promise<Record<string, ConversationMeta>> {
  const path = getConversationsPath(ensureDir(memoryDir));
  const { value } = await readJsonObjectFile<Record<string, ConversationMeta>>(path);
  return value ?? {};
}

async function loadConversations(): Promise<Record<string, ConversationMeta>> {
  return loadConversationsIn(getMemoryDir());
}

export async function saveConversationsIn(memoryDir: string, conv: Record<string, ConversationMeta>): Promise<void> {
  const path = getConversationsPath(ensureDir(memoryDir));
  await atomicWriteUtf8(path, JSON.stringify(conv, null, 2));
}

async function saveConversations(conv: Record<string, ConversationMeta>): Promise<void> {
  await saveConversationsIn(getMemoryDir(), conv);
}

function getMessagesPath(conversationId: string): string {
  return getMessagesPathIn(getMemoryDir(), conversationId);
}

export async function loadMessagesIn(memoryDir: string, conversationId: string): Promise<MessageRecord[]> {
  const path = getMessagesPathIn(ensureDir(memoryDir), conversationId);
  return readJsonArrayFile<MessageRecord>(path);
}

async function loadMessages(conversationId: string): Promise<MessageRecord[]> {
  return loadMessagesIn(getMemoryDir(), conversationId);
}

export async function saveMessagesIn(
  memoryDir: string,
  conversationId: string,
  messages: MessageRecord[]
): Promise<void> {
  const path = getMessagesPathIn(ensureDir(memoryDir), conversationId);
  await atomicWriteUtf8(path, JSON.stringify(messages, null, 2));
}

async function saveMessages(conversationId: string, messages: MessageRecord[]): Promise<void> {
  await saveMessagesIn(getMemoryDir(), conversationId, messages);
}

export async function createConversationIn(memoryDir: string): Promise<string> {
  const id = generateId("conv");
  const conv = await loadConversationsIn(memoryDir);
  conv[id] = { title: null, createdAt: Date.now(), sessionKind: "chat" };
  await saveConversationsIn(memoryDir, conv);
  await saveMessagesIn(memoryDir, id, []);
  return id;
}

async function createConversation(): Promise<string> {
  return createConversationIn(getMemoryDir());
}

export async function getConversationIn(
  memoryDir: string,
  id: string
): Promise<{ id: string; title: string | null; createdAt: number } | null> {
  const conv = await loadConversationsIn(memoryDir);
  const c = conv[id];
  if (!c) return null;
  return { id, title: c.title, createdAt: c.createdAt };
}

async function getConversation(id: string): Promise<{ id: string; title: string | null; createdAt: number } | null> {
  return getConversationIn(getMemoryDir(), id);
}

export async function getConversationMetaForId(conversationId: string): Promise<ConversationMeta | null> {
  const conv = await loadConversations();
  const c = conv[conversationId];
  return c ? { ...c } : null;
}

export async function patchConversationMetaIn(
  memoryDir: string,
  conversationId: string,
  patch: Partial<ConversationMeta>
): Promise<void> {
  const conv = await loadConversationsIn(memoryDir);
  const c = conv[conversationId];
  if (!c) return;
  Object.assign(c, patch);
  await saveConversationsIn(memoryDir, conv);
}

export async function patchConversationMeta(conversationId: string, patch: Partial<ConversationMeta>): Promise<void> {
  return patchConversationMetaIn(getMemoryDir(), conversationId, patch);
}

export async function setConversationTitleIn(
  memoryDir: string,
  conversationId: string,
  title: string,
  source: ConversationTitleSource = "user"
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) return;
  await patchConversationMetaIn(memoryDir, conversationId, { title: trimmed, titleSource: source });
}

async function setConversationTitle(
  conversationId: string,
  title: string,
  source: ConversationTitleSource = "user"
): Promise<void> {
  return setConversationTitleIn(getMemoryDir(), conversationId, title, source);
}

/** Legacy time label for voice-dictation threads; LLM may replace when configured. */
export async function markVoiceDictationSession(conversationId: string): Promise<string> {
  const time = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const title = `Dictation @ ${time}`;
  await patchConversationMetaIn(getMemoryDir(), conversationId, {
    title,
    titleSource: "auto",
    sessionKind: "dictation",
  });
  scheduleConversationTitleRefinement(conversationId);
  return title;
}

export async function listConversationsIn(
  memoryDir: string
): Promise<
  {
    id: string;
    title: string | null;
    createdAt: number;
    sessionKind?: ConversationSessionKind;
    hasAssistantReply?: boolean;
    hasMessages?: boolean;
  }[]
> {
  const conv = await loadConversationsIn(memoryDir);
  return Object.entries(conv)
    .map(([id, c]) => ({
      id,
      title: c.title,
      createdAt: c.createdAt,
      sessionKind: c.sessionKind,
      hasAssistantReply: c.hasAssistantReply,
      hasMessages: c.hasMessages,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Deletes message-less conversations and backfills hasMessages for existing threads. */
export async function pruneEmptyConversationsIn(memoryDir: string): Promise<{ removed: number }> {
  const conv = await loadConversationsIn(memoryDir);
  let removed = 0;
  let changed = false;
  for (const [id, meta] of Object.entries(conv)) {
    const messages = await loadMessagesIn(memoryDir, id);
    if (messages.length === 0) {
      delete conv[id];
      const messagesPath = getMessagesPathIn(memoryDir, id);
      if (await fileExists(messagesPath)) await unlink(messagesPath);
      removed += 1;
      changed = true;
      continue;
    }
    if (meta.hasMessages !== true) {
      conv[id] = { ...meta, hasMessages: true };
      changed = true;
    }
  }
  if (changed) await saveConversationsIn(memoryDir, conv);
  return { removed };
}

export async function pruneEmptyConversations(): Promise<{ removed: number }> {
  return pruneEmptyConversationsIn(getMemoryDir());
}

async function listConversations(): Promise<{ id: string; title: string | null; createdAt: number }[]> {
  return listConversationsIn(getMemoryDir());
}

export async function getExistingChatgptIdsIn(memoryDir: string): Promise<string[]> {
  const conv = await loadConversationsIn(memoryDir);
  const ids: string[] = [];
  for (const c of Object.values(conv)) {
    if (c.isFromChatGPT === true && typeof c.chatgptId === "string" && c.chatgptId) {
      ids.push(c.chatgptId);
    }
  }
  return ids;
}

async function getExistingChatgptIds(): Promise<string[]> {
  return getExistingChatgptIdsIn(getMemoryDir());
}

export async function getExistingClaudeIdsIn(memoryDir: string): Promise<string[]> {
  const conv = await loadConversationsIn(memoryDir);
  const ids: string[] = [];
  for (const c of Object.values(conv)) {
    if (c.isFromClaude === true && typeof c.claudeId === "string" && c.claudeId) {
      ids.push(c.claudeId);
    }
  }
  return ids;
}

async function getExistingClaudeIds(): Promise<string[]> {
  return getExistingClaudeIdsIn(getMemoryDir());
}

export interface ImportConversationItem {
  title: string | null;
  createdAt: number;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  chatgptId?: string;
  claudeId?: string;
}

export async function importConversationsIn(
  memoryDir: string,
  items: ImportConversationItem[]
): Promise<{ imported: number; ids: string[] }> {
  const conv = await loadConversationsIn(memoryDir);
  const ids: string[] = [];
  for (const item of items) {
    const id = generateId("conv");
    const hasAssistantReply = item.messages.some((m) => m.role === "assistant");
    const hasMessages = item.messages.length > 0;
    const meta: ConversationMeta = {
      title: item.title,
      createdAt: item.createdAt,
      sessionKind: "chat",
      ...(hasMessages ? { hasMessages: true } : {}),
      ...(hasAssistantReply ? { hasAssistantReply: true } : {}),
      ...(item.title ? { titleSource: "imported" as const } : {}),
    };
    if (item.chatgptId != null) {
      meta.isFromChatGPT = true;
      meta.chatgptId = item.chatgptId;
    }
    if (item.claudeId != null) {
      meta.isFromClaude = true;
      meta.claudeId = item.claudeId;
    }
    conv[id] = meta;
    const messages: MessageRecord[] = item.messages.map((m) => ({ role: m.role, content: m.content }));
    await saveMessagesIn(memoryDir, id, messages);
    ids.push(id);
  }
  await saveConversationsIn(memoryDir, conv);
  return { imported: ids.length, ids };
}

async function importConversations(items: ImportConversationItem[]): Promise<{ imported: number; ids: string[] }> {
  return importConversationsIn(getMemoryDir(), items);
}

export async function deleteConversationIn(memoryDir: string, conversationId: string): Promise<void> {
  const conv = await loadConversationsIn(memoryDir);
  if (!(conversationId in conv)) return;
  delete conv[conversationId];
  await saveConversationsIn(memoryDir, conv);
  const messagesPath = getMessagesPathIn(memoryDir, conversationId);
  if (await fileExists(messagesPath)) await unlink(messagesPath);
}

async function deleteConversation(conversationId: string): Promise<void> {
  return deleteConversationIn(getMemoryDir(), conversationId);
}

export async function resetStoredDataIn(memoryDir: string): Promise<void> {
  const dir = ensureDir(memoryDir);
  const conv = await loadConversationsIn(memoryDir);
  for (const id of Object.keys(conv)) {
    const path = getMessagesPathIn(memoryDir, id);
    if (await fileExists(path)) await unlink(path);
  }
  await saveConversationsIn(memoryDir, {});

  const userMemPath = join(dir, USER_MEMORY_FILE);
  if (await fileExists(userMemPath)) await unlink(userMemPath);

  const tasksPath = join(dir, TASKS_FILE);
  if (await fileExists(tasksPath)) await unlink(tasksPath);

  const plansPath = join(dir, PLANS_FILE);
  if (await fileExists(plansPath)) await unlink(plansPath);
}

export interface DataStatusSnapshot {
  localDataDir: string;
  appStateDir: string;
  localDataExists: boolean;
  conversationsCount: number;
  messageFilesCount: number;
  notesFilesCount: number;
  hasSettingsFile: boolean;
  hasThemesDir: boolean;
  recordingsDir: string;
  recordingsLocalOnly: true;
  legacyMemoryDir: string;
  legacyMemoryExists: boolean;
  sync: Awaited<ReturnType<typeof getSyncStatus>>;
}

async function getDataStatus(): Promise<DataStatusSnapshot> {
  const appStateDir = getMemoryDir();
  const conv = await loadConversationsIn(appStateDir);
  const appStateFiles = existsSync(appStateDir) ? await readdir(appStateDir) : [];
  const noteDir = join(appStateDir, "notes");
  const notesFiles = existsSync(noteDir) ? await readdir(noteDir) : [];
  return {
    localDataDir: getLocalDataDir(),
    appStateDir,
    localDataExists: existsSync(getLocalDataDir()),
    conversationsCount: Object.keys(conv).length,
    messageFilesCount: appStateFiles.filter((name) => name.startsWith("messages_") && name.endsWith(".json")).length,
    notesFilesCount: notesFiles.filter((name) => name.endsWith(".md")).length,
    hasSettingsFile: existsSync(getLocalDataSettingsPath()),
    hasThemesDir: existsSync(getLocalDataThemesDir()),
    recordingsDir: getRecordingsDir(),
    recordingsLocalOnly: true,
    legacyMemoryDir: getLegacyMemoryDir(),
    legacyMemoryExists: existsSync(getLegacyMemoryDir()),
    sync: await getSyncStatus(),
  };
}

async function openAppDataFolder(): Promise<void> {
  await shell.openPath(getUserDataDir());
}

async function runCleanupLegacyMemory(): Promise<{ removed: boolean }> {
  return { removed: cleanupLegacyMemoryDir() };
}

export async function getMessagesIn(memoryDir: string, conversationId: string): Promise<ChatMessage[]> {
  const rows = await loadMessagesIn(memoryDir, conversationId);
  return rows.map((r) => {
    const msg: ChatMessage = { role: r.role as ChatMessage["role"], content: r.content };
    if (r.toolCalls?.length) msg.toolCalls = r.toolCalls;
    if (typeof r.timestamp === "number") msg.timestamp = r.timestamp;
    if (typeof r.model === "string" && r.model) msg.model = r.model;
    return msg;
  });
}

async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  return getMessagesIn(getMemoryDir(), conversationId);
}

/** Removes the last message if it is from the user; returns its content, or null. */
export async function popLastUserMessageIn(memoryDir: string, conversationId: string): Promise<string | null> {
  const rows = await loadMessagesIn(memoryDir, conversationId);
  if (rows.length === 0 || rows[rows.length - 1].role !== "user") return null;
  const content = rows[rows.length - 1].content;
  await saveMessagesIn(memoryDir, conversationId, rows.slice(0, -1));
  return content;
}

export async function popLastUserMessage(conversationId: string): Promise<string | null> {
  return popLastUserMessageIn(getMemoryDir(), conversationId);
}

export async function appendMessageIn(
  memoryDir: string,
  conversationId: string,
  role: ChatMessage["role"],
  content: string,
  options?: AppendMessageMeta
): Promise<void> {
  const messages = await loadMessagesIn(memoryDir, conversationId);
  const record: MessageRecord = { role, content };
  if (options?.toolCalls?.length) record.toolCalls = options.toolCalls;
  if (typeof options?.timestamp === "number") record.timestamp = options.timestamp;
  if (typeof options?.model === "string" && options.model) record.model = options.model;
  const wasEmpty = messages.length === 0;
  messages.push(record);
  await saveMessagesIn(memoryDir, conversationId, messages);

  const needsHasMessages = wasEmpty;
  const needsAssistantReply = role === "assistant";
  if (needsHasMessages || needsAssistantReply) {
    const conv = await loadConversationsIn(memoryDir);
    const meta = conv[conversationId];
    if (meta) {
      let changed = false;
      const next = { ...meta };
      if (needsHasMessages && meta.hasMessages !== true) {
        next.hasMessages = true;
        changed = true;
      }
      if (needsAssistantReply && meta.hasAssistantReply !== true) {
        next.hasAssistantReply = true;
        changed = true;
      }
      if (changed) {
        conv[conversationId] = next;
        await saveConversationsIn(memoryDir, conv);
        if (needsAssistantReply && next.hasAssistantReply) {
          notifyConversationTitleUpdated(conversationId);
        }
      }
    }
  }

  if (role === "user") {
    scheduleConversationTitleRefinement(conversationId);
  }
}

async function appendMessage(
  conversationId: string,
  role: ChatMessage["role"],
  content: string,
  options?: AppendMessageMeta
): Promise<void> {
  return appendMessageIn(getMemoryDir(), conversationId, role, content, options);
}

export async function getUserMemoryIn(memoryDir: string): Promise<Record<string, string>> {
  const path = getUserMemoryPath(ensureDir(memoryDir));
  if (!(await fileExists(path))) return {};
  const data = JSON.parse(await readFile(path, "utf-8"));
  return typeof data === "object" && data !== null ? data : {};
}

async function getUserMemory(): Promise<Record<string, string>> {
  return getUserMemoryIn(getMemoryDir());
}

export async function setUserMemoryIn(memoryDir: string, key: string, value: string): Promise<void> {
  const mem = await getUserMemoryIn(memoryDir);
  mem[key] = value;
  await writeFile(getUserMemoryPath(ensureDir(memoryDir)), JSON.stringify(mem, null, 2), "utf-8");
}

async function setUserMemory(key: string, value: string): Promise<void> {
  return setUserMemoryIn(getMemoryDir(), key, value);
}

export async function deleteUserMemoryKeyIn(memoryDir: string, key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) return;
  const mem = await getUserMemoryIn(memoryDir);
  if (!(trimmed in mem)) return;
  delete mem[trimmed];
  const path = getUserMemoryPath(ensureDir(memoryDir));
  if (Object.keys(mem).length === 0) {
    if (await fileExists(path)) await unlink(path);
  } else {
    await writeFile(path, JSON.stringify(mem, null, 2), "utf-8");
  }
}

async function deleteUserMemoryKey(key: string): Promise<void> {
  return deleteUserMemoryKeyIn(getMemoryDir(), key);
}

const SNIPPET_CHARS_BEFORE = 80;
const SNIPPET_CHARS_AFTER = 120;
const SNIPPET_MAX_LINES = 3;

export function extractSnippet(
  content: string,
  queryLower: string,
  matchIndex: number
): { snippet: string; snippetMatchRange: [number, number] } {
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

export async function searchConversationsIn(
  memoryDir: string,
  query: string,
  composeFirstOnly = false
): Promise<SearchResult[]> {
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) return [];
  const conv = await loadConversationsIn(memoryDir);
  const results: SearchResult[] = [];
  for (const [id, meta] of Object.entries(conv)) {
    if (composeFirstOnly && meta.hasMessages !== true) continue;
    const { title, createdAt } = meta;
    const titleStr = title ?? "";
    const titleMatched = titleStr.toLowerCase().includes(q);
    let titleMatchRange: [number, number] | undefined;
    if (titleMatched) {
      const idx = titleStr.toLowerCase().indexOf(q);
      titleMatchRange = [idx, idx + q.length];
    }
    const messages = await loadMessagesIn(memoryDir, id);
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

async function searchConversations(query: string, composeFirstOnly = true): Promise<SearchResult[]> {
  return searchConversationsIn(getMemoryDir(), query, composeFirstOnly);
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
  ipcMain.handle("memory:searchConversations", (_e, query: string, composeFirstOnly?: boolean) =>
    searchConversations(query, composeFirstOnly !== false)
  );
  ipcMain.handle("memory:openAppDataFolder", () => openAppDataFolder());
  ipcMain.handle("memory:getDataStatus", () => getDataStatus());
  ipcMain.handle("memory:cleanupLegacyMemory", () => runCleanupLegacyMemory());
  ipcMain.handle("memory:setConversationTitle", async (_e, conversationId: string, title: string) => {
    await setConversationTitle(conversationId, title, "user");
    notifyConversationTitleUpdated(conversationId);
  });
  ipcMain.handle("memory:markVoiceDictationSession", (_e, conversationId: string) =>
    markVoiceDictationSession(conversationId)
  );
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
  getExistingClaudeIds,
  importConversations,
  searchConversations,
  setConversationTitle,
};
