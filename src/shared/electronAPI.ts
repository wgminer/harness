import type { AppendMessageMeta, LayoutOptions, Plan, SearchResult } from "./types";

export interface TaskItem {
  id: string;
  title: string;
  status: string;
}

export interface TasksPayload {
  tasks: TaskItem[];
  lastAction?: string;
  affectedIds?: string[];
  error?: string;
}

export interface ElectronAPI {
  app: {
    getVersion: () => Promise<string>;
  };
  windowSize: {
    get: () => Promise<"small" | "large">;
    toggle: () => Promise<"small" | "large">;
  };
  settings: {
    get: () => Promise<unknown>;
    set: (partial: unknown) => Promise<unknown>;
  };
  memory: {
    createConversation: () => Promise<string>;
    getConversation: (id: string) => Promise<unknown>;
    listConversations: () => Promise<{ id: string; title: string | null; createdAt: number }[]>;
    deleteConversation: (id: string) => Promise<void>;
    getMessages: (id: string) => Promise<
      { role: string; content: string; toolCalls?: unknown; timestamp?: number; model?: string }[]
    >;
    appendMessage: (conversationId: string, role: string, content: string, meta?: AppendMessageMeta) => Promise<void>;
    getUserMemory: () => Promise<Record<string, string>>;
    setUserMemory: (key: string, value: string) => Promise<void>;
    deleteUserMemoryKey: (key: string) => Promise<void>;
    searchConversations: (query: string) => Promise<SearchResult[]>;
    importFromChatGPTFolder: () => Promise<{ imported: number; errors: string[] }>;
    resetStoredData: () => Promise<void>;
    setConversationTitle: (conversationId: string, title: string) => Promise<void>;
    setVoiceDictationTitle: (conversationId: string) => Promise<string>;
  };
  plans: {
    list: () => Promise<Plan[]>;
    create: (title: string, description: string) => Promise<Plan>;
    update: (planId: string, updates: { title?: string; description?: string }) => Promise<Plan | null>;
    delete: (planId: string) => Promise<void>;
    addConversation: (planId: string, conversationId: string) => Promise<Plan | null>;
    removeConversation: (planId: string, conversationId: string) => Promise<Plan | null>;
  };
  tasks: {
    list: () => Promise<TasksPayload>;
    create: (title: string, status?: string) => Promise<TasksPayload>;
    update: (payload: { id: string; title?: string; status?: string }) => Promise<TasksPayload>;
    delete: (id: string) => Promise<TasksPayload>;
    clearCompleted: () => Promise<TasksPayload>;
  };
  chat: {
    send: (conversationId: string, content: string) => Promise<void>;
    generateReply: (conversationId: string) => Promise<void>;
    stop: () => Promise<void>;
    resolveGatedTool: (pendingId: string, action: "proceed" | "cancel") => Promise<void>;
    onStreamChunk: (cb: (conversationId: string, chunk: string) => void) => () => void;
    onStreamEnd: (cb: (conversationId: string) => void) => () => void;
    onToolPanelUpdate: (cb: (conversationId: string, toolName: string, payload: unknown) => void) => () => void;
    onConversationTitleUpdated: (cb: (conversationId: string) => void) => () => void;
    onTitleGenerationStarted: (cb: (conversationId: string) => void) => () => void;
    onTitleGenerationEnded: (cb: (conversationId: string) => void) => () => void;
  };
  customization: {
    getActiveTheme: () => Promise<string>;
    setTheme: (css: string) => Promise<void>;
    getLayoutOptions: () => Promise<LayoutOptions>;
    setLayout: (o: Partial<LayoutOptions>) => Promise<void>;
    onUpdated: (cb: (p: { type: string }) => void) => () => void;
  };
  fileTools: {
    getAllowedRoots: () => Promise<string[]>;
  };
  recording: {
    requestMicrophoneAccess: () => Promise<boolean>;
    saveWav: (data: ArrayBuffer) => Promise<{ path: string }>;
    showInFolder: (path: string) => Promise<void>;
    exportWav: (data: ArrayBuffer, suggestedName?: string) => Promise<{ path: string } | { cancelled: true }>;
    openFolder: () => Promise<void>;
    transcribe: (data: ArrayBuffer) => Promise<{ text: string } | { error: string }>;
    pasteText: (text: string) => Promise<void>;
    done: () => Promise<void>;
    onStartSilent: (cb: () => void) => () => void;
    onStopAndPaste: (cb: (wasFocused: boolean) => void) => () => void;
    onCancel: (cb: () => void) => () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
