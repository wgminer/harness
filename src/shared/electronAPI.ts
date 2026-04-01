import type { AppendMessageMeta, LayoutOptions, Plan, SearchResult } from "./types";
import type { ThemeSettings } from "./theme";
import type { UsageStatsSnapshot } from "./usageStats";

export interface TaskItem {
  id: string;
  title: string;
  tags: string[];
  createdAt?: number;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
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
  env: {
    isHarnessE2E: () => Promise<boolean>;
  };
  system: {
    getPlatform: () => Promise<NodeJS.Platform>;
    macosAccessibilityTrusted: () => Promise<boolean>;
    requestAccessibilityPrompt: () => Promise<boolean>;
    openAccessibilitySettings: () => Promise<void>;
  };
  windowSize: {
    get: () => Promise<"small" | "large">;
    toggle: () => Promise<"small" | "large">;
  };
  settings: {
    get: () => Promise<unknown>;
    set: (partial: unknown) => Promise<unknown>;
  };
  /** Locally accumulated usage (tokens / words); not synced with provider billing. */
  usage: {
    getStats: () => Promise<UsageStatsSnapshot>;
    reset: () => Promise<UsageStatsSnapshot>;
    openOpenAIDashboard: () => Promise<void>;
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
    create: (title: string, tags?: string[]) => Promise<TasksPayload>;
    update: (payload: { id: string; title?: string; tags?: string[] }) => Promise<TasksPayload>;
    delete: (id: string) => Promise<TasksPayload>;
    clearCompleted: () => Promise<TasksPayload>;
  };
  chat: {
    send: (conversationId: string, content: string) => Promise<void>;
    /** Replace last user message with polish instruction + same text, then stream. */
    polishLastUser: (conversationId: string) => Promise<void>;
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
    /** CSS from persisted theme (empty when using built-in base.css only). */
    getActiveTheme: () => Promise<string>;
    getThemeSettings: () => Promise<ThemeSettings>;
    setThemeSettings: (settings: ThemeSettings | null) => Promise<void>;
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
  /** Present when the app is launched with `HARNESS_E2E=1`. */
  e2e?: {
    injectFnEvent: (phase: "down" | "up", ms?: number) => Promise<void>;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
