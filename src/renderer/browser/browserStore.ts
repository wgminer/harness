import { DEFAULT_LAYOUT, DEFAULT_SETTINGS, type LayoutOptions, type Settings } from "../../shared/types";
import { DEFAULT_UI_SESSION, normalizeUiSession, type UiSession } from "../../shared/uiSession";
import type { ChatModeId } from "../../shared/chatModes";
import { isChatModeId } from "../../shared/chatModes";
import type { ChatMessage, MessageAttachment } from "../../shared/types";
import type { Note, NoteSummary } from "../../shared/writing";
import { titleFromMarkdownContent, UNTITLED_NOTE_TITLE } from "../../shared/writing";
import type { TaskItem } from "../../shared/desktopAPI";
import { isTaskStatus, type TaskStatus } from "../../shared/taskStatus";
import { addTags, normalizeTags, removeTags } from "../../shared/tags";

export const BROWSER_STORAGE_KEY = "harness.web.v1";

export type KeyValueStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export type BrowserSecrets = {
  openaiApiKey: string;
  tavilyApiKey: string;
  r2SecretAccessKey: string;
};

export type BrowserConversation = {
  id: string;
  title: string | null;
  createdAt: number;
  sessionKind: "dictation" | "chat";
  hasAssistantReply: boolean;
  hasMessages: boolean;
  chatMode?: ChatModeId;
  dictationReplyAction?: string;
  messages: ChatMessage[];
};

export type BrowserState = {
  settings: Settings;
  secrets: BrowserSecrets;
  uiSession: UiSession;
  layout: LayoutOptions;
  conversations: BrowserConversation[];
  userMemory: Record<string, string>;
  notes: Note[];
  tasks: TaskItem[];
};

const EMPTY_SECRETS: BrowserSecrets = {
  openaiApiKey: "",
  tavilyApiKey: "",
  r2SecretAccessKey: "",
};

export function generateBrowserId(prefix: string, now = Date.now(), random = Math.random): string {
  const rand = Math.floor(random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0");
  return `${prefix}_${now}_${rand}`;
}

export function memoryStorage(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function defaultStorage(): KeyValueStore {
  if (typeof localStorage !== "undefined") return localStorage;
  return memoryStorage();
}

function viteEnv(name: string): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.[name]?.trim() ?? "";
}

function cloneSettings(settings: Settings): Settings {
  return structuredClone(settings);
}

export function mergeSettings(current: Settings, partial: Partial<Settings>): Settings {
  const recording = { ...DEFAULT_SETTINGS.recording!, ...current.recording, ...partial.recording };
  const cleanup = {
    ...DEFAULT_SETTINGS.transcription!.cleanup!,
    ...current.transcription?.cleanup,
    ...partial.transcription?.cleanup,
  };
  return {
    ...current,
    ...partial,
    openai: { ...current.openai, ...partial.openai },
    recording,
    transcription: {
      cleanup,
      dictionary: partial.transcription?.dictionary ?? current.transcription?.dictionary ?? [],
    },
    search: { ...DEFAULT_SETTINGS.search, ...current.search, ...partial.search },
    notes: {
      templates: partial.notes?.templates ?? current.notes?.templates ?? DEFAULT_SETTINGS.notes!.templates,
      defaultTemplateId:
        partial.notes?.defaultTemplateId ??
        current.notes?.defaultTemplateId ??
        DEFAULT_SETTINGS.notes!.defaultTemplateId,
    },
    sync: { ...DEFAULT_SETTINGS.sync!, ...current.sync, ...partial.sync },
    chat: { ...DEFAULT_SETTINGS.chat!, ...current.chat, ...partial.chat },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...current.appearance, ...partial.appearance },
    weather: { ...DEFAULT_SETTINGS.weather!, ...current.weather, ...partial.weather },
  };
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function normalizeConversation(raw: unknown): BrowserConversation | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  if (typeof data.id !== "string" || !data.id) return null;
  const createdAt = typeof data.createdAt === "number" ? data.createdAt : Date.now();
  const messages = Array.isArray(data.messages) ? (data.messages as ChatMessage[]) : [];
  const chatMode = isChatModeId(data.chatMode) ? data.chatMode : undefined;
  return {
    id: data.id,
    title: typeof data.title === "string" ? data.title : null,
    createdAt,
    sessionKind: data.sessionKind === "dictation" ? "dictation" : "chat",
    hasAssistantReply: data.hasAssistantReply === true || messages.some((m) => m.role === "assistant"),
    hasMessages: data.hasMessages === true || messages.length > 0,
    chatMode,
    dictationReplyAction:
      typeof data.dictationReplyAction === "string" ? data.dictationReplyAction : undefined,
    messages,
  };
}

export function createBrowserStore(storage: KeyValueStore = defaultStorage()) {
  const load = (): BrowserState => {
    const raw = storage.getItem(BROWSER_STORAGE_KEY);
    if (!raw) {
      const seededKey = viteEnv("VITE_OPENAI_API_KEY");
      return {
        settings: cloneSettings(DEFAULT_SETTINGS),
        secrets: { ...EMPTY_SECRETS, openaiApiKey: seededKey },
        uiSession: { ...DEFAULT_UI_SESSION },
        layout: { ...DEFAULT_LAYOUT },
        conversations: [],
        userMemory: {},
        notes: [],
        tasks: [],
      };
    }
    try {
      const parsed = JSON.parse(raw) as Partial<BrowserState>;
      const seededKey = viteEnv("VITE_OPENAI_API_KEY");
      const secrets: BrowserSecrets = {
        ...EMPTY_SECRETS,
        ...parsed.secrets,
      };
      if (!secrets.openaiApiKey && seededKey) secrets.openaiApiKey = seededKey;
      return {
        settings: mergeSettings(DEFAULT_SETTINGS, parsed.settings ?? {}),
        secrets,
        uiSession: normalizeUiSession(parsed.uiSession),
        layout: {
          sidebar: parsed.layout?.sidebar === "right" ? "right" : "left",
        },
        conversations: Array.isArray(parsed.conversations)
          ? parsed.conversations.map(normalizeConversation).filter((c): c is BrowserConversation => c != null)
          : [],
        userMemory:
          parsed.userMemory && typeof parsed.userMemory === "object" ? { ...parsed.userMemory } : {},
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      };
    } catch {
      return {
        settings: cloneSettings(DEFAULT_SETTINGS),
        secrets: { ...EMPTY_SECRETS, openaiApiKey: viteEnv("VITE_OPENAI_API_KEY") },
        uiSession: { ...DEFAULT_UI_SESSION },
        layout: { ...DEFAULT_LAYOUT },
        conversations: [],
        userMemory: {},
        notes: [],
        tasks: [],
      };
    }
  };

  let state = load();

  const persist = () => {
    storage.setItem(BROWSER_STORAGE_KEY, JSON.stringify(state));
  };

  const update = (mutator: (prev: BrowserState) => BrowserState): BrowserState => {
    state = mutator(state);
    persist();
    return state;
  };

  return {
    get(): BrowserState {
      return state;
    },
    settings(): Settings {
      return state.settings;
    },
    setSettings(partial: Partial<Settings>): Settings {
      state = { ...state, settings: mergeSettings(state.settings, partial) };
      persist();
      return state.settings;
    },
    secrets(): BrowserSecrets {
      return state.secrets;
    },
    setSecret<K extends keyof BrowserSecrets>(key: K, value: string): void {
      state = { ...state, secrets: { ...state.secrets, [key]: value } };
      persist();
    },
    uiSession(): UiSession {
      return state.uiSession;
    },
    setUiSession(partial: Partial<UiSession>): UiSession {
      state = { ...state, uiSession: normalizeUiSession({ ...state.uiSession, ...partial }) };
      persist();
      return state.uiSession;
    },
    layout(): LayoutOptions {
      return state.layout;
    },
    setLayout(partial: Partial<LayoutOptions>): LayoutOptions {
      state = {
        ...state,
        layout: { sidebar: partial.sidebar === "right" ? "right" : "left" },
      };
      persist();
      return state.layout;
    },
    conversations(): BrowserConversation[] {
      return state.conversations;
    },
    conversation(id: string): BrowserConversation | undefined {
      return state.conversations.find((c) => c.id === id);
    },
    createConversation(chatMode?: string): string {
      const id = generateBrowserId("conv");
      const mode = isChatModeId(chatMode) && chatMode !== "chat" ? chatMode : undefined;
      const row: BrowserConversation = {
        id,
        title: null,
        createdAt: Date.now(),
        sessionKind: "chat",
        hasAssistantReply: false,
        hasMessages: false,
        chatMode: mode,
        messages: [],
      };
      state = { ...state, conversations: [row, ...state.conversations] };
      persist();
      return id;
    },
    deleteConversation(id: string): void {
      state = { ...state, conversations: state.conversations.filter((c) => c.id !== id) };
      persist();
    },
    setConversationChatMode(id: string, chatMode: string): void {
      const mode = isChatModeId(chatMode) ? chatMode : "chat";
      state = {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, chatMode: mode === "chat" ? undefined : mode } : c,
        ),
      };
      persist();
    },
    setConversationTitle(id: string, title: string): void {
      state = {
        ...state,
        conversations: state.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
      };
      persist();
    },
    appendMessage(
      id: string,
      role: string,
      content: string,
      meta?: { toolCalls?: ChatMessage["toolCalls"]; timestamp?: number; model?: string; attachments?: MessageAttachment[] },
    ): void {
      const timestamp = meta?.timestamp ?? Date.now();
      state = {
        ...state,
        conversations: state.conversations.map((c) => {
          if (c.id !== id) return c;
          const message: ChatMessage = {
            role: role as ChatMessage["role"],
            content,
            timestamp,
            ...(meta?.toolCalls ? { toolCalls: meta.toolCalls } : {}),
            ...(meta?.model ? { model: meta.model } : {}),
            ...(meta?.attachments ? { attachments: meta.attachments } : {}),
          };
          return {
            ...c,
            hasMessages: true,
            hasAssistantReply: c.hasAssistantReply || role === "assistant",
            messages: [...c.messages, message],
          };
        }),
      };
      persist();
    },
    popLastUserMessage(id: string): string | null {
      const conv = state.conversations.find((c) => c.id === id);
      if (!conv) return null;
      let lastUser = -1;
      for (let i = conv.messages.length - 1; i >= 0; i -= 1) {
        if (conv.messages[i].role === "user") {
          lastUser = i;
          break;
        }
      }
      if (lastUser < 0) return null;
      const content = conv.messages[lastUser].content;
      const messages = conv.messages.filter((_, i) => i !== lastUser);
      state = {
        ...state,
        conversations: state.conversations.map((c) =>
          c.id === id
            ? {
                ...c,
                messages,
                hasMessages: messages.length > 0,
                hasAssistantReply: messages.some((m) => m.role === "assistant"),
              }
            : c,
        ),
      };
      persist();
      return content;
    },
    userMemory(): Record<string, string> {
      return state.userMemory;
    },
    setUserMemory(key: string, value: string): void {
      const next = { ...state.userMemory };
      if (!key.trim()) return;
      next[key] = value;
      state = { ...state, userMemory: next };
      persist();
    },
    deleteUserMemoryKey(key: string): void {
      const next = { ...state.userMemory };
      delete next[key];
      state = { ...state, userMemory: next };
      persist();
    },
    notes(): Note[] {
      return state.notes;
    },
    createNote(title?: string, content?: string): Note {
      const id = generateBrowserId("note");
      const now = Date.now();
      const body = content ?? "# Note\n";
      const resolvedTitle = titleFromMarkdownContent(body, title?.trim() || UNTITLED_NOTE_TITLE);
      const note: Note = {
        id,
        title: resolvedTitle,
        content: body,
        createdAt: now,
        updatedAt: now,
        wordCount: countWords(body),
      };
      state = { ...state, notes: [note, ...state.notes] };
      persist();
      return note;
    },
    readNote(id: string): Note | null {
      return state.notes.find((n) => n.id === id) ?? null;
    },
    saveNote(id: string, content: string): Note {
      const now = Date.now();
      let saved: Note | null = null;
      state = {
        ...state,
        notes: state.notes.map((n) => {
          if (n.id !== id) return n;
          saved = {
            ...n,
            content,
            title: titleFromMarkdownContent(content, n.title),
            updatedAt: now,
            wordCount: countWords(content),
          };
          return saved;
        }),
      };
      persist();
      if (!saved) throw new Error("Note not found.");
      return saved;
    },
    deleteNote(id: string): NoteSummary[] {
      state = { ...state, notes: state.notes.filter((n) => n.id !== id) };
      persist();
      return state.notes.map(({ id: noteId, title, updatedAt, createdAt, wordCount }) => ({
        id: noteId,
        title,
        updatedAt,
        createdAt,
        wordCount,
      }));
    },
    tasks(): TaskItem[] {
      return state.tasks;
    },
    setTasks(tasks: TaskItem[]): TaskItem[] {
      state = { ...state, tasks };
      persist();
      return state.tasks;
    },
    createTask(title: string, tags?: string[], status?: TaskStatus): TaskItem[] {
      const now = Date.now();
      const task: TaskItem = {
        id: generateBrowserId("task"),
        title: title.trim() || "Untitled",
        status: isTaskStatus(status) ? status : "pending",
        tags: normalizeTags(tags),
        createdAt: now,
        updatedAt: now,
      };
      return this.setTasks([task, ...state.tasks]);
    },
    updateTask(payload: {
      id: string;
      title?: string;
      status?: TaskStatus;
      tags?: string[];
      add_tags?: string[];
      remove_tags?: string[];
    }): TaskItem[] {
      const tasks = state.tasks.map((task) => {
        if (task.id !== payload.id) return task;
        let tags = payload.tags != null ? normalizeTags(payload.tags) : task.tags;
        if (payload.add_tags) tags = addTags(tags, payload.add_tags);
        if (payload.remove_tags) tags = removeTags(tags, payload.remove_tags);
        return {
          ...task,
          title: payload.title != null ? payload.title : task.title,
          status: payload.status ?? task.status,
          tags,
          updatedAt: Date.now(),
        };
      });
      return this.setTasks(tasks);
    },
    deleteTask(id: string): TaskItem[] {
      return this.setTasks(state.tasks.filter((t) => t.id !== id));
    },
    clearCompletedTasks(): TaskItem[] {
      return this.setTasks(state.tasks.filter((t) => t.status !== "completed" && t.status !== "cancelled"));
    },
    replace(next: BrowserState): void {
      state = next;
      persist();
    },
    update,
  };
}

export type BrowserStore = ReturnType<typeof createBrowserStore>;
