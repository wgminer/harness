import type {
  AppendMessageMeta,
  ContextPreview,
  LayoutOptions,
  MessageAttachment,
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
  microphonePermission: "granted" | "denied" | "undetermined" | "unsupported";
}

export interface HarnessAPI {
  app: {
    getVersion: () => Promise<string>;
  };
  env: {
    isHarnessE2E: () => Promise<boolean>;
    isHarnessDev: () => Promise<boolean>;
    /** When true, image generate/adjust writes stub PNGs (no OpenAI). */
    isStubImages: () => Promise<boolean>;
  };
  system: {
    getPlatform: () => Promise<NodeJS.Platform>;
    macosAccessibilityTrusted: () => Promise<boolean>;
    requestAccessibilityPrompt: () => Promise<boolean>;
    openAccessibilitySettings: () => Promise<void>;
    openMicrophoneSettings: () => Promise<void>;
    openSpeechRecognitionSettings: () => Promise<void>;
  };
  settings: {
    get: () => Promise<Settings>;
    set: (partial: Partial<Settings>) => Promise<void>;
    getSystemPromptPreview: (
      platform: "desktop" | "ios",
      chatMode?: string,
    ) => Promise<SystemPromptPreview>;
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
    createConversation: (chatMode?: string) => Promise<string>;
    getConversation: (id: string) => Promise<unknown>;
    listConversations: () => Promise<
      {
        id: string;
        title: string | null;
        createdAt: number;
        sessionKind?: "dictation" | "chat";
        hasAssistantReply?: boolean;
        hasMessages?: boolean;
        chatMode?: "chat" | "decide" | "write" | "refine";
        dictationReplyAction?: string;
      }[]
    >;
    deleteConversation: (id: string) => Promise<void>;
    setConversationChatMode: (conversationId: string, chatMode: string) => Promise<void>;
    getMessages: (id: string) => Promise<
      {
        role: string;
        content: string;
        toolCalls?: unknown;
        timestamp?: number;
        model?: string;
        attachments?: MessageAttachment[];
      }[]
    >;
    appendMessage: (conversationId: string, role: string, content: string, meta?: AppendMessageMeta) => Promise<void>;
    getUserMemory: () => Promise<Record<string, string>>;
    setUserMemory: (key: string, value: string) => Promise<void>;
    deleteUserMemoryKey: (key: string) => Promise<void>;
    searchConversations: (query: string, composeFirstOnly?: boolean) => Promise<SearchResult[]>;
    importFromChatGPTFolder: () => Promise<{ imported: number; errors: string[] }>;
    /** Pick a Claude export folder and return a reviewable preview (no writes). */
    previewClaudeImport: () => Promise<{
      folderPath: string | null;
      found: number;
      alreadyImported: number;
      conversations: Array<{
        claudeId: string;
        title: string | null;
        createdAt: number;
        messageCount: number;
        alreadyImported: boolean;
      }>;
      errors: string[];
    }>;
    /** Persist selected Claude conversations from a previously previewed folder. */
    confirmClaudeImport: (
      folderPath: string,
      claudeIds?: string[],
    ) => Promise<{ imported: number; updated: number; errors: string[] }>;
    /** Distill user memories from a pasted export produced by another assistant. */
    importLlmContext: (exportText: string) => Promise<
      | {
          ok: true;
          result: { added: number; updated: number; truncated: boolean; importSource: string | null };
        }
      | { ok: false; error: string }
    >;
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
    /** Classify-once (or return cached) dictation strip action: `run` or a vocab word. */
    ensureDictationReplyAction: (conversationId: string) => Promise<string>;
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
    onDictationReplyActionUpdated: (
      cb: (conversationId: string, action: string) => void,
    ) => () => void;
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
  /** Tavily-backed lookups used by the desktop UI (not assistant tools). */
  search: {
    lookupImage: (query: string) => Promise<{
      query: string;
      imageUrl?: string;
      description?: string;
      error?: string;
    }>;
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
    read: (id: string) => Promise<GeneratedImage | null>;
    delete: (id: string) => Promise<GeneratedImage[]>;
    generate: (input: ImageGenerateInput) => Promise<GeneratedImage>;
    setActiveVersion: (id: string, versionId: string) => Promise<GeneratedImage>;
  };
  recording: {
    /** Call once after IPC listeners are registered so Fn monitor can start. */
    signalFrontendReady: () => Promise<void>;
    requestMicrophoneAccess: () => Promise<boolean>;
    microphonePermissionStatus: () => Promise<
      "granted" | "denied" | "undetermined" | "unsupported"
    >;
    saveWav: (data: ArrayBuffer) => Promise<{ path: string }>;
    /**
     * Copy an OS-dropped audio path into audio-recordings/drop-cache for
     * `convertFileSrc` / fetch in the webview.
     */
    stageDroppedAudio: (path: string) => Promise<{ path: string; name: string }>;
    showInFolder: (path: string) => Promise<void>;
    exportWav: (data: ArrayBuffer, suggestedName?: string) => Promise<{ path: string } | { cancelled: true }>;
    openFolder: () => Promise<void>;
    /** Count audio files under audio-recordings/ (excludes the local index JSON). */
    countFiles: () => Promise<number>;
    /** File count + summed WAV duration under audio-recordings/. */
    archiveStats: () => Promise<{ fileCount: number; durationMs: number }>;
    transcribe: (
      data: ArrayBuffer,
      options?: { requestId?: string }
    ) => Promise<{ text: string; cleanupSkipped?: "no_api_key" } | { error: string }>;
    cancelTranscription: (requestId: string) => Promise<void>;
    pasteText: (text: string) => Promise<void>;
    getGlobalStatus: () => Promise<GlobalRecordingStatus>;
    retryGlobalTranscription: (path: string) => Promise<void>;
    cancelGlobalTranscription: () => Promise<void>;
    cancelGlobalSession: () => Promise<void>;
    stopGlobalRecording: () => Promise<void>;
    onGlobalRecordingStarted: (cb: (info: { focused: boolean }) => void) => () => void;
    onGlobalRecordingStopped: (cb: () => void) => () => void;
    onGlobalRecordingTranscribing: (
      cb: (info: { recordingPath?: string }) => void,
    ) => () => void;
    onGlobalRecordingCancelled: (cb: () => void) => () => void;
    onGlobalRecordingError: (
      cb: (info: { message: string; recordingPath?: string }) => void,
    ) => () => void;
    onGlobalRecordingLevel: (cb: (level: number) => void) => () => void;
    onGlobalTranscriptReady: (cb: (text: string) => void) => () => void;
    onGlobalTranscriptDelivered: (cb: (conversationId: string) => void) => () => void;
  };
  weather: {
    /** Current conditions for Settings default ZIP (compose ambient). */
    getCurrent: () => Promise<{
      tempF: number;
      place: string;
      state: string;
      zip: string;
      weather: string;
      label: string;
    }>;
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
