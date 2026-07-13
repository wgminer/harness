import type {
  AppendMessageMeta,
  ContextPreview,
  LayoutOptions,
  Plan,
  RecordingLink,
  SearchResult,
  Settings,
  SystemPromptPreview,
} from "./types";
import type {
  Note,
  NoteEditProposal,
  NoteEditProposalInput,
  NoteSpellCheckInput,
  NoteSummary,
} from "./writing";
import type { GeneratedImage, ImageGenerateInput } from "./images";
import type { SyncResult, SyncStatus } from "./sync";
import type { TaskStatus } from "./taskStatus";
import type { UiSession } from "./uiSession";
import type { UpdateStatus } from "./updateStatus";

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
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

export interface GlobalRecordingStatus {
  monitorHealth: "stopped" | "running" | "accessibility_denied";
  frontendReady: boolean;
  hotkeyActive: boolean;
  sessionMode: string;
  captureBackend: string;
}

export interface HarnessAPI {
  app: {
    getVersion: () => Promise<string>;
  };
  env: {
    isHarnessE2E: () => Promise<boolean>;
    isHarnessDev: () => Promise<boolean>;
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
    get: () => Promise<Settings>;
    set: (partial: Partial<Settings>) => Promise<void>;
    getSystemPromptPreview: (platform: "desktop" | "ios") => Promise<SystemPromptPreview>;
  };
  credentials: {
    getStatus: () => Promise<{
      hasOpenAIApiKey: boolean;
      hasTavilyApiKey: boolean;
      hasR2SecretAccessKey: boolean;
      encryptionAvailable: boolean;
    }>;
    getSecretsForSettings: () => Promise<{
      openaiApiKey: string;
      tavilyApiKey: string;
      r2SecretAccessKey: string;
    }>;
    setOpenAIApiKey: (value: string) => Promise<void>;
    setTavilyApiKey: (value: string) => Promise<void>;
    setR2SecretAccessKey: (value: string) => Promise<void>;
  };
  memory: {
    createConversation: () => Promise<string>;
    getConversation: (id: string) => Promise<unknown>;
    listConversations: () => Promise<
      {
        id: string;
        title: string | null;
        createdAt: number;
        sessionKind?: "dictation" | "chat";
        hasAssistantReply?: boolean;
        hasMessages?: boolean;
      }[]
    >;
    deleteConversation: (id: string) => Promise<void>;
    getMessages: (id: string) => Promise<
      { role: string; content: string; toolCalls?: unknown; timestamp?: number; model?: string }[]
    >;
    appendMessage: (conversationId: string, role: string, content: string, meta?: AppendMessageMeta) => Promise<void>;
    getUserMemory: () => Promise<Record<string, string>>;
    setUserMemory: (key: string, value: string) => Promise<void>;
    deleteUserMemoryKey: (key: string) => Promise<void>;
    searchConversations: (query: string, composeFirstOnly?: boolean) => Promise<SearchResult[]>;
    importFromChatGPTFolder: () => Promise<{ imported: number; errors: string[] }>;
    importFromClaudeFolder: () => Promise<{ imported: number; errors: string[] }>;
    /** Distill user-memory facts from a pasted export produced by another assistant. */
    importLlmContext: (exportText: string) => Promise<
      | {
          ok: true;
          result: { added: number; updated: number; truncated: boolean; importSource: string | null };
        }
      | { ok: false; error: string }
    >;
    /** Distill durable user-memory facts from recent conversations (auto-merge). */
    runCompileNow: () => Promise<
      | { ok: true; result: { ranAt: number; considered: number; added: number; updated: number; skipped: boolean } }
      | { ok: false; error: string }
    >;
    getCompileStatus: () => Promise<{
      lastRunAt: number | null;
      lastRunDateLocal: string | null;
      lastAddedCount: number;
      lastUpdatedCount: number;
      lastConsideredCount: number;
      lastError: string | null;
    }>;
    openAppDataFolder: () => Promise<void>;
    getDataStatus: () => Promise<{
      localDataDir: string;
      appStateDir: string;
      localDataExists: boolean;
      conversationsCount: number;
      messageFilesCount: number;
      notesFilesCount: number;
      hasSettingsFile: boolean;
      recordingsDir: string;
      recordingsLocalOnly: true;
      legacyMemoryDir: string;
      legacyMemoryExists: boolean;
      sync: SyncStatus;
    }>;
    cleanupLegacyMemory: () => Promise<{ removed: boolean }>;
    setConversationTitle: (conversationId: string, title: string) => Promise<void>;
    markVoiceDictationSession: (conversationId: string) => Promise<string>;
    linkDictationRecording: (conversationId: string, path: string) => Promise<void>;
    getConversationRecordings: (conversationId: string) => Promise<{ recordings: RecordingLink[] }>;
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
    create: (title: string, tags?: string[], status?: TaskStatus) => Promise<TasksPayload>;
    update: (payload: {
      id: string;
      title?: string;
      status?: TaskStatus;
      tags?: string[];
      add_tags?: string[];
      remove_tags?: string[];
    }) => Promise<TasksPayload>;
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
    getContextPreview: (conversationId?: string | null) => Promise<ContextPreview>;
    onStreamChunk: (cb: (conversationId: string, chunk: string) => void) => () => void;
    onStreamEnd: (cb: (conversationId: string) => void) => () => void;
    onNoteStreamOpen: (
      cb: (conversationId: string, noteId: string, title: string, summary: string) => void,
    ) => () => void;
    onNoteStreamChunk: (cb: (conversationId: string, noteId: string, chunk: string) => void) => () => void;
    onNoteStreamClose: (cb: (conversationId: string, noteId: string) => void) => () => void;
    onToolPanelUpdate: (cb: (conversationId: string, toolName: string, payload: unknown) => void) => () => void;
    onConversationTitleUpdated: (cb: (conversationId: string) => void) => () => void;
    onTitleGenerationStarted: (cb: (conversationId: string) => void) => () => void;
    onTitleGenerationEnded: (cb: (conversationId: string) => void) => () => void;
  };
  uiSession: {
    get: () => Promise<UiSession>;
    set: (partial: Partial<UiSession>) => Promise<UiSession>;
  };
  customization: {
    getLayoutOptions: () => Promise<LayoutOptions>;
    setLayout: (o: Partial<LayoutOptions>) => Promise<void>;
    onUpdated: (cb: (p: { type: string }) => void) => () => void;
  };
  fileTools: {
    getAllowedRoots: () => Promise<string[]>;
  };
  /** Multi-note Notes surface, separate from chat conversations. */
  notes: {
    list: () => Promise<NoteSummary[]>;
    create: (title?: string, content?: string) => Promise<Note>;
    read: (id: string) => Promise<Note | null>;
    save: (id: string, content: string) => Promise<Note>;
    delete: (id: string) => Promise<NoteSummary[]>;
    showInFolder: (id: string) => Promise<void>;
    proposeEdit: (input: NoteEditProposalInput) => Promise<NoteEditProposal>;
    spellCheck: (input: NoteSpellCheckInput) => Promise<NoteEditProposal>;
    print: (html: string, jobName?: string) => Promise<{ success: boolean }>;
    openSticky: (noteId: string) => Promise<{
      noteId: string;
      pinned: boolean;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }>;
    setStickyPinned: (noteId: string, pinned: boolean) => Promise<void>;
    setStickyTitle: (noteId: string, title: string) => Promise<void>;
    popInSticky: (noteId: string) => Promise<void>;
    onOpenInMain: (cb: (noteId: string) => void) => () => void;
  };
  /** Generated image library objects (peer to notes/chats). */
  images: {
    list: () => Promise<GeneratedImage[]>;
    create: () => Promise<GeneratedImage>;
    read: (id: string) => Promise<GeneratedImage | null>;
    delete: (id: string) => Promise<GeneratedImage[]>;
    generate: (input: ImageGenerateInput) => Promise<GeneratedImage>;
  };
  recording: {
    /** Call once after IPC listeners are registered so Fn monitor can start. */
    signalFrontendReady: () => Promise<void>;
    requestMicrophoneAccess: () => Promise<boolean>;
    saveWav: (data: ArrayBuffer) => Promise<{ path: string }>;
    showInFolder: (path: string) => Promise<void>;
    exportWav: (data: ArrayBuffer, suggestedName?: string) => Promise<{ path: string } | { cancelled: true }>;
    openFolder: () => Promise<void>;
    transcribe: (
      data: ArrayBuffer,
      options?: { requestId?: string }
    ) => Promise<{ text: string; cleanupSkipped?: "no_api_key" } | { error: string }>;
    cancelTranscription: (requestId: string) => Promise<void>;
    pasteText: (text: string) => Promise<void>;
    getGlobalStatus: () => Promise<GlobalRecordingStatus>;
    onGlobalRecordingStarted: (cb: () => void) => () => void;
    onGlobalRecordingStopped: (cb: () => void) => () => void;
    onGlobalRecordingCancelled: (cb: () => void) => () => void;
    onGlobalRecordingError: (cb: (message: string) => void) => () => void;
    onGlobalTranscriptReady: (cb: (text: string) => void) => () => void;
    onGlobalTranscriptDelivered: (cb: (conversationId: string) => void) => () => void;
  };
  sync: {
    getStatus: () => Promise<SyncStatus>;
    runNow: () => Promise<SyncResult>;
    testConnection: () => Promise<{ ok: boolean; error?: string }>;
    setR2Config: (partial: {
      accountId?: string;
      bucket?: string;
      prefix?: string;
      accessKeyId?: string;
    }) => Promise<SyncStatus>;
    setR2SecretAccessKey: (secret: string) => Promise<void>;
    onChanged: (cb: () => void) => () => void;
  };
  updater: {
    check: () => Promise<void>;
    getStatus: () => Promise<UpdateStatus>;
    downloadAndInstall: () => Promise<void>;
    onStatus: (cb: (status: UpdateStatus) => void) => () => void;
  };
  /** Present when the app is launched with `HARNESS_E2E=1`. */
  e2e?: {
    injectFnEvent: (phase: "down" | "up", ms?: number) => Promise<void>;
  };
}

declare global {
  interface Window {
    harness: HarnessAPI;
  }
}
