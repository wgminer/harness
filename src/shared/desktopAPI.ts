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
import type { TextFile } from "./files";
import type {
  Note,
  NoteChangedEvent,
  NoteEditProposal,
  NoteEditProposalInput,
  NoteSpellCheckInput,
  NoteSummary,
} from "./writing";
import type { GeneratedImage, ImageCreateInput, ImageGenerateInput } from "./images";
import type { SyncResult, SyncStatus } from "./sync";
import type { TaskStatus } from "./taskStatus";
import type { TranscriptionEngineId, TranscriptionEngineStatus } from "./transcriptionEngines";
import type { UiSession } from "./uiSession";
import type { UpdateStatus } from "./updateStatus";

export interface TaskItem {
  id: string;
  title: string;
  status: TaskStatus;
  tags: string[];
  createdAt?: number;
  updatedAt?: number;
  /** Subtask parent id (one level deep). Missing or unknown parent => top level. */
  parentId?: string;
  /** Eisenhower "important" axis. Urgency is derived from `dueDate`, never stored. */
  important?: boolean;
  /** Local calendar day, `YYYY-MM-DD`. */
  dueDate?: string;
  estimateMinutes?: number;
  metadata?: Record<string, unknown>;
}

/** Matrix fields on a task update: null clears `dueDate` / `estimateMinutes`. */
export interface TaskMatrixPatch {
  important?: boolean;
  dueDate?: string | null;
  estimateMinutes?: number | null;
}

export interface CodingScopeMeta {
  kind: "project" | "self";
  root: string;
}

/** What a terminal panel needs to catch up with a running session. */
export interface TerminalSnapshot {
  /** Base64 of the raw output kept so far. */
  scrollback: string;
  /** Output bytes produced so far; data chunks below this offset are already in `scrollback`. */
  endOffset: number;
  cwd: string;
}

export interface TerminalDataChunk {
  conversationId: string;
  offset: number;
  /** Base64 of the raw output bytes. */
  data: string;
}

export interface TasksPayload {
  tasks: TaskItem[];
  lastAction?: string;
  affectedIds?: string[];
  error?: string;
}

export type RecordingChime = "start" | "stop" | "done" | "cancel" | "error";

/** A saved take under audio-recordings/ (`rec_<ms>.wav`). */
export interface RecentRecording {
  path: string;
  /** Epoch ms. */
  recordedAt: number;
  durationMs: number | null;
}

export interface GlobalRecordingStatus {
  monitorHealth: "stopped" | "running" | "accessibility_denied";
  frontendReady: boolean;
  hotkeyActive: boolean;
  sessionMode: string;
  captureBackend: string;
  microphonePermission: "granted" | "denied" | "undetermined" | "unsupported";
}

export interface GmailStatus {
  clientConfigured: boolean;
  connected: boolean;
  email: string | null;
}

export interface ExternalButtonStatus {
  enabled: boolean;
  host: string;
  keyConfigured: boolean;
  state: "off" | "searching" | "connected" | "error";
  message: string | null;
}

export interface HarnessAPI {
  app: {
    getVersion: () => Promise<string>;
  };
  env: {
    isHarnessE2E: () => Promise<boolean>;
    isHarnessDev: () => Promise<boolean>;
    /** When true, image generate/adjust writes stub PNGs (no provider call). */
    isStubImages: () => Promise<boolean>;
    /** True when the renderer is running as the browser debug shell (no Tauri). */
    isHarnessWeb: () => Promise<boolean>;
  };
  system: {
    getPlatform: () => Promise<NodeJS.Platform>;
    macosAccessibilityTrusted: () => Promise<boolean>;
    requestAccessibilityPrompt: () => Promise<boolean>;
    openAccessibilitySettings: () => Promise<void>;
    openMicrophoneSettings: () => Promise<void>;
    openSpeechRecognitionSettings: () => Promise<void>;
    /** Reveal a local path in Finder (or the OS file manager). */
    showInFolder: (path: string) => Promise<void>;
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
      /** True when a Google AI key is saved or supplied by the environment; images then use Google. */
      hasGoogleApiKey: boolean;
      encryptionAvailable: boolean;
    }>;
    getSecretsForSettings: () => Promise<{
      openaiApiKey: string;
      tavilyApiKey: string;
      r2SecretAccessKey: string;
      googleApiKey: string;
    }>;
    setOpenAIApiKey: (value: string) => Promise<void>;
    setTavilyApiKey: (value: string) => Promise<void>;
    setGoogleApiKey: (value: string) => Promise<void>;
    setR2SecretAccessKey: (value: string) => Promise<void>;
  };
  /** Voice PE centre button over the ESPHome API, standing in for Fn. */
  externalButton: {
    getStatus: () => Promise<ExternalButtonStatus>;
    /** Saves and reconnects. Omit `key` (or pass "") to keep the stored one. */
    configure: (input: { enabled: boolean; host: string; key?: string }) => Promise<ExternalButtonStatus>;
    onStatus: (cb: (status: ExternalButtonStatus) => void) => () => void;
  };
  gmail: {
    getStatus: () => Promise<GmailStatus>;
    setClient: (clientId: string, clientSecret: string) => Promise<GmailStatus>;
    /** Opens Google consent in the browser; resolves once the account is connected. */
    connect: () => Promise<GmailStatus>;
    disconnect: () => Promise<GmailStatus>;
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
        chatMode?: "chat" | "qa";
        codingScope?: CodingScopeMeta | null;
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
  coding: {
    getScope: (conversationId: string) => Promise<CodingScopeMeta | null>;
    /** Folder picker only — does not persist. */
    pickProjectFolder: () => Promise<CodingScopeMeta | null>;
    /** Resolve Harness UI self-scope meta — does not persist. */
    getSelfScope: () => Promise<CodingScopeMeta>;
    setScope: (conversationId: string, scope: CodingScopeMeta | null) => Promise<void>;
    selfScopeAvailable: () => Promise<boolean>;
  };
  /** One shell per conversation, started in its coding scope root. Desktop-local. */
  terminal: {
    /** Attach to the conversation's terminal, starting its shell on first use. */
    open: (conversationId: string, cols: number, rows: number) => Promise<TerminalSnapshot>;
    write: (conversationId: string, data: string) => Promise<void>;
    resize: (conversationId: string, cols: number, rows: number) => Promise<void>;
    /** End the conversation's shell. */
    close: (conversationId: string) => Promise<void>;
    onData: (cb: (chunk: TerminalDataChunk) => void) => () => void;
    onExit: (cb: (conversationId: string) => void) => () => void;
  };
  tasks: {
    list: () => Promise<TasksPayload>;
    create: (title: string, tags?: string[], status?: TaskStatus, parentId?: string) => Promise<TasksPayload>;
    update: (payload: TaskMatrixPatch & {
      id: string;
      title?: string;
      status?: TaskStatus;
      /** A task id nests it; null moves it back to the top level. */
      parentId?: string | null;
      tags?: string[];
      add_tags?: string[];
      remove_tags?: string[];
    }) => Promise<TasksPayload>;
    delete: (id: string) => Promise<TasksPayload>;
    clearCompleted: () => Promise<TasksPayload>;
    /** Ask the model for subtasks and save them under `id`. */
    breakdown: (id: string) => Promise<TasksPayload>;
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
    /** Live or checkpointed turn waiting on tool approval (for remount / restart rehydrate). */
    getActiveTurn: () => Promise<{
      conversationId: string | null;
      hasActiveStream: boolean;
      content: string;
      reasoning?: string;
      pendingTools: Array<{ toolName: string; payload: unknown }>;
    }>;
    getContextPreview: (conversationId?: string | null) => Promise<ContextPreview>;
    onStreamChunk: (cb: (conversationId: string, chunk: string) => void) => () => void;
    /** Reasoning summary text for the in-flight assistant reply. */
    onStreamReasoning: (cb: (conversationId: string, chunk: string) => void) => () => void;
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
    create: (
      title?: string,
      content?: string,
      options?: { conversationId?: string }
    ) => Promise<Note>;
    read: (id: string) => Promise<Note | null>;
    /** With `expectedUpdatedAt`, rejects with `note_conflict` if the note changed since. */
    save: (id: string, content: string, options?: { expectedUpdatedAt?: number }) => Promise<Note>;
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
    onChanged: (cb: (event: NoteChangedEvent) => void) => () => void;
  };
  /** Plain text files on disk, edited in place (`harness <path>`, Finder Open With). */
  files: {
    readText: (path: string) => Promise<TextFile>;
    /** Modification time in ms, or null when the file no longer exists. */
    stat: (path: string) => Promise<number | null>;
    /** With `expectedModifiedMs`, rejects with `file_conflict` if the file changed on disk. */
    saveText: (
      path: string,
      content: string,
      options?: { expectedModifiedMs?: number },
    ) => Promise<number>;
    importAsNote: (path: string) => Promise<Note>;
    openWindow: (path: string) => Promise<void>;
    installCli: () => Promise<{ path: string; onPath: boolean }>;
  };
  /** Generated image library objects (peer to notes/chats). */
  images: {
    list: () => Promise<GeneratedImage[]>;
    create: (input: ImageCreateInput) => Promise<GeneratedImage>;
    read: (id: string) => Promise<GeneratedImage | null>;
    delete: (id: string) => Promise<GeneratedImage[]>;
    generate: (input: ImageGenerateInput) => Promise<GeneratedImage>;
    setActiveVersion: (id: string, versionId: string) => Promise<GeneratedImage>;
    cancel: (id: string) => Promise<void>;
    deleteVersion: (id: string, versionId: string) => Promise<GeneratedImage>;
    copyToClipboard: (id: string) => Promise<void>;
    revealInFinder: (id: string) => Promise<void>;
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
    /** Newest saved takes (default 3) for the Settings retry list. */
    listRecent: (limit?: number) => Promise<RecentRecording[]>;
    transcribe: (
      data: ArrayBuffer,
      options?: { requestId?: string }
    ) => Promise<{ text: string; cleanupSkipped?: "no_api_key" } | { error: string }>;
    cancelTranscription: (requestId: string) => Promise<void>;
    /** Whether an engine's on-device models are downloaded (Apple is always ready). */
    transcriptionEngineStatus: (engine: TranscriptionEngineId) => Promise<TranscriptionEngineStatus>;
    /** Start an engine's one-time model download in the background. */
    prepareTranscriptionEngine: (engine: TranscriptionEngineId) => Promise<void>;
    /** Play a recording cue natively (not throttled with the webview). */
    playChime: (kind: RecordingChime) => Promise<void>;
    pasteText: (text: string) => Promise<void>;
    getGlobalStatus: () => Promise<GlobalRecordingStatus>;
    /** `focused` lands the transcript in the composer instead of pasting it back. */
    retryGlobalTranscription: (path: string, options?: { focused?: boolean }) => Promise<void>;
    cancelGlobalTranscription: () => Promise<void>;
    cancelGlobalSession: () => Promise<void>;
    stopGlobalRecording: () => Promise<void>;
    onGlobalRecordingStarted: (cb: (info: { focused: boolean }) => void) => () => void;
    onGlobalRecordingStopped: (cb: () => void) => () => void;
    onGlobalRecordingTranscribing: (
      cb: (info: { recordingPath?: string }) => void,
    ) => () => void;
    onGlobalRecordingCancelled: (cb: () => void) => () => void;
    /** Menu bar "Retry Last Recording" started while Harness is focused. */
    onGlobalRecordingRetrying: (cb: () => void) => () => void;
    onGlobalRecordingError: (
      cb: (info: { message: string; recordingPath?: string; needsAccessibility?: boolean }) => void,
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
