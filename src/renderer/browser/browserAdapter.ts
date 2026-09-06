import type { HarnessAPI, TasksPayload } from "../../shared/desktopAPI";
import type { SearchResult } from "../../shared/conversationSearch";
import { searchConversations, searchTitleOnly } from "../../shared/conversationSearch";
import { IDLE_UPDATE_STATUS } from "../../shared/updateStatus";
import type { SyncResult, SyncStatus } from "../../shared/sync";
import type { NoteSummary } from "../../shared/writing";
import pkg from "../../../package.json";
import { createBrowserChat } from "./browserChat";
import { emitBrowserEvent, onBrowserEvent } from "./browserEvents";
import { browserContextPreview, browserSystemPromptPreview } from "./browserPrompt";
import { createBrowserStore } from "./browserStore";

const WEB_UNSUPPORTED = "This action is desktop-only. The browser shell keeps chat, notes, tasks, and settings in localStorage.";

function browserSyncStatus(): SyncStatus {
  return {
    provider: "s3Backup",
    configured: false,
    accountId: null,
    bucket: null,
    prefix: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastAction: null,
    lastSyncedRevision: null,
    remoteRevision: null,
    statusLine: "Browser — localStorage only",
  };
}

function tasksPayload(tasks: ReturnType<ReturnType<typeof createBrowserStore>["tasks"]>, lastAction?: string, affectedIds?: string[]): TasksPayload {
  return { tasks, lastAction, affectedIds };
}

function noteSummaries(notes: Array<{ id: string; title: string; updatedAt: number; createdAt: number; wordCount: number }>): NoteSummary[] {
  return notes.map(({ id, title, updatedAt, createdAt, wordCount }) => ({
    id,
    title,
    updatedAt,
    createdAt,
    wordCount,
  }));
}

export function createBrowserAdapter(): HarnessAPI {
  const store = createBrowserStore();
  const chat = createBrowserChat(store);

  return {
    app: {
      getVersion: async () => `${pkg.version}-web`,
    },
    env: {
      isHarnessE2E: async () => false,
      isHarnessDev: async () => true,
      isStubImages: async () => true,
      isHarnessWeb: async () => true,
    },
    system: {
      getPlatform: async () => "linux",
      macosAccessibilityTrusted: async () => true,
      requestAccessibilityPrompt: async () => false,
      openAccessibilitySettings: async () => {},
      openMicrophoneSettings: async () => {},
      openSpeechRecognitionSettings: async () => {},
    },
    settings: {
      get: async () => store.settings(),
      set: async (partial) => {
        store.setSettings(partial);
      },
      getSystemPromptPreview: async (platform, chatMode) =>
        browserSystemPromptPreview(store, platform, chatMode),
    },
    credentials: {
      getStatus: async () => ({
        hasOpenAIApiKey: store.secrets().openaiApiKey.trim().length > 0,
        hasTavilyApiKey: store.secrets().tavilyApiKey.trim().length > 0,
        hasR2SecretAccessKey: false,
        encryptionAvailable: false,
      }),
      getSecretsForSettings: async () => ({ ...store.secrets() }),
      setOpenAIApiKey: async (value) => {
        store.setSecret("openaiApiKey", value.trim());
      },
      setTavilyApiKey: async (value) => {
        store.setSecret("tavilyApiKey", value.trim());
      },
      setR2SecretAccessKey: async () => {},
    },
    memory: {
      createConversation: async (chatMode) => store.createConversation(chatMode),
      getConversation: async (id) => store.conversation(id) ?? null,
      listConversations: async () =>
        store.conversations().map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt,
          sessionKind: c.sessionKind,
          hasAssistantReply: c.hasAssistantReply,
          hasMessages: c.hasMessages,
          chatMode: c.chatMode,
          dictationReplyAction: c.dictationReplyAction,
        })),
      deleteConversation: async (id) => {
        store.deleteConversation(id);
      },
      setConversationChatMode: async (conversationId, chatMode) => {
        store.setConversationChatMode(conversationId, chatMode);
      },
      getMessages: async (id) => store.conversation(id)?.messages ?? [],
      appendMessage: async (conversationId, role, content, meta) => {
        store.appendMessage(conversationId, role, content, meta);
      },
      getUserMemory: async () => store.userMemory(),
      setUserMemory: async (key, value) => {
        store.setUserMemory(key, value);
      },
      deleteUserMemoryKey: async (key) => {
        store.deleteUserMemoryKey(key);
      },
      searchConversations: async (query, composeFirstOnly) => {
        const conversationHits = searchConversations(
          store.conversations().map((c) => ({
            id: c.id,
            title: c.title,
            createdAt: c.createdAt,
            sessionKind: c.sessionKind,
            hasAssistantReply: c.hasAssistantReply,
            hasMessages: c.hasMessages,
            messages: c.messages,
          })),
          query,
          { requireMessages: composeFirstOnly === true },
        );
        const noteHits = searchTitleOnly(
          store.notes().map((n) => ({ id: n.id, title: n.title, activityAt: n.updatedAt })),
          query,
          "note",
        );
        const results: SearchResult[] = [...conversationHits, ...noteHits];
        results.sort((a, b) => b.score - a.score || b.createdAt - a.createdAt);
        return results;
      },
      importFromChatGPTFolder: async () => ({
        imported: 0,
        errors: [WEB_UNSUPPORTED],
      }),
      previewClaudeImport: async () => ({
        folderPath: null,
        found: 0,
        alreadyImported: 0,
        conversations: [],
        errors: [WEB_UNSUPPORTED],
      }),
      confirmClaudeImport: async () => ({
        imported: 0,
        updated: 0,
        errors: [WEB_UNSUPPORTED],
      }),
      importLlmContext: async () => ({ ok: false, error: WEB_UNSUPPORTED }),
      openAppDataFolder: async () => {
        console.info("Browser shell data is in localStorage under harness.web.v1");
      },
      getDataStatus: async () => {
        const conversations = store.conversations();
        return {
          localDataDir: "browser:localStorage",
          appStateDir: "browser:localStorage",
          localDataExists: true,
          conversationsCount: conversations.length,
          messageFilesCount: conversations.filter((c) => c.messages.length > 0).length,
          notesFilesCount: store.notes().length,
          hasSettingsFile: true,
          recordingsDir: "browser:unavailable",
          recordingsLocalOnly: true as const,
          legacyMemoryDir: "",
          legacyMemoryExists: false,
          sync: browserSyncStatus(),
        };
      },
      cleanupLegacyMemory: async () => ({ removed: false }),
      setConversationTitle: async (conversationId, title) => {
        store.setConversationTitle(conversationId, title);
        emitBrowserEvent("chat:conversationTitleUpdated", { conversationId });
      },
      markVoiceDictationSession: async (conversationId) => conversationId,
      linkDictationRecording: async () => {},
      getConversationRecordings: async () => ({ recordings: [] }),
    },
    tasks: {
      list: async () => tasksPayload(store.tasks()),
      create: async (title, tags, status) =>
        tasksPayload(store.createTask(title, tags, status), "create"),
      update: async (payload) => tasksPayload(store.updateTask(payload), "update", [payload.id]),
      delete: async (id) => tasksPayload(store.deleteTask(id), "delete", [id]),
      clearCompleted: async () => tasksPayload(store.clearCompletedTasks(), "clearCompleted"),
    },
    chat: {
      send: (conversationId, content) => chat.send(conversationId, content),
      polishLastUser: (conversationId) => chat.polishLastUser(conversationId),
      generateReply: (conversationId) => chat.generateReply(conversationId),
      ensureDictationReplyAction: async () => "run",
      stop: () => chat.stop(),
      resolveGatedTool: async () => {},
      getContextPreview: async (conversationId) => browserContextPreview(store, conversationId),
      onStreamChunk: (cb) =>
        onBrowserEvent<{ conversationId: string; chunk: string }>("chat:streamChunk", (p) =>
          cb(p.conversationId, p.chunk),
        ),
      onStreamEnd: (cb) =>
        onBrowserEvent<{ conversationId: string }>("chat:streamEnd", (p) => cb(p.conversationId)),
      onNoteStreamOpen: () => () => {},
      onNoteStreamChunk: () => () => {},
      onNoteStreamClose: () => () => {},
      onToolPanelUpdate: () => () => {},
      onConversationTitleUpdated: (cb) =>
        onBrowserEvent<{ conversationId: string }>("chat:conversationTitleUpdated", (p) =>
          cb(p.conversationId),
        ),
      onTitleGenerationStarted: (cb) =>
        onBrowserEvent<{ conversationId: string }>("chat:titleGenerationStarted", (p) =>
          cb(p.conversationId),
        ),
      onTitleGenerationEnded: (cb) =>
        onBrowserEvent<{ conversationId: string }>("chat:titleGenerationEnded", (p) =>
          cb(p.conversationId),
        ),
      onDictationReplyActionUpdated: () => () => {},
    },
    uiSession: {
      get: async () => store.uiSession(),
      set: async (partial) => store.setUiSession(partial),
    },
    customization: {
      getLayoutOptions: async () => store.layout(),
      setLayout: async (o) => {
        store.setLayout(o);
        emitBrowserEvent("customization:updated", { type: "layout" });
      },
      onUpdated: (cb) => onBrowserEvent<{ type: string }>("customization:updated", cb),
    },
    coding: {
      getScope: async () => null,
      pickProjectFolder: async () => {
        throw new Error(WEB_UNSUPPORTED);
      },
      getSelfScope: async () => {
        throw new Error(WEB_UNSUPPORTED);
      },
      setScope: async () => {},
      selfScopeAvailable: async () => false,
    },
    search: {
      lookupImage: async () => ({ query: "", error: WEB_UNSUPPORTED }),
    },
    notes: {
      list: async () => noteSummaries(store.notes()),
      create: async (title, content) => store.createNote(title, content),
      read: async (id) => store.readNote(id),
      save: async (id, content) => store.saveNote(id, content),
      delete: async (id) => store.deleteNote(id),
      showInFolder: async () => {},
      proposeEdit: async () => {
        throw new Error(WEB_UNSUPPORTED);
      },
      spellCheck: async () => {
        throw new Error(WEB_UNSUPPORTED);
      },
      print: async () => ({ success: false }),
      openSticky: async () => {
        throw new Error(WEB_UNSUPPORTED);
      },
      setStickyPinned: async () => {},
      setStickyTitle: async () => {},
      popInSticky: async () => {},
      onOpenInMain: () => () => {},
    },
    images: {
      list: async () => [],
      read: async () => null,
      delete: async () => [],
      generate: async () => {
        throw new Error("Image generation is not available in the browser debug shell.");
      },
      setActiveVersion: async () => {
        throw new Error("Image generation is not available in the browser debug shell.");
      },
    },
    recording: {
      signalFrontendReady: async () => {},
      requestMicrophoneAccess: async () => false,
      microphonePermissionStatus: async () => "unsupported",
      saveWav: async () => {
        throw new Error(WEB_UNSUPPORTED);
      },
      stageDroppedAudio: async () => {
        throw new Error(WEB_UNSUPPORTED);
      },
      showInFolder: async () => {},
      exportWav: async () => ({ cancelled: true as const }),
      openFolder: async () => {},
      countFiles: async () => 0,
      archiveStats: async () => ({ fileCount: 0, durationMs: 0 }),
      transcribe: async () => ({ error: WEB_UNSUPPORTED }),
      cancelTranscription: async () => {},
      pasteText: async () => {},
      getGlobalStatus: async () => ({
        monitorHealth: "stopped",
        frontendReady: true,
        hotkeyActive: false,
        sessionMode: "idle",
        captureBackend: "none",
        microphonePermission: "unsupported",
      }),
      retryGlobalTranscription: async () => {},
      cancelGlobalTranscription: async () => {},
      cancelGlobalSession: async () => {},
      stopGlobalRecording: async () => {},
      onGlobalRecordingStarted: () => () => {},
      onGlobalRecordingStopped: () => () => {},
      onGlobalRecordingTranscribing: () => () => {},
      onGlobalRecordingCancelled: () => () => {},
      onGlobalRecordingError: () => () => {},
      onGlobalRecordingLevel: () => () => {},
      onGlobalTranscriptReady: () => () => {},
      onGlobalTranscriptDelivered: () => () => {},
    },
    weather: {
      getCurrent: async () => {
        const zip = store.settings().weather?.defaultZip ?? "";
        return {
          tempF: 0,
          place: "Browser",
          state: "",
          zip,
          weather: "debug",
          label: "Browser",
        };
      },
    },
    sync: {
      getStatus: async () => browserSyncStatus(),
      runNow: async (): Promise<SyncResult> => ({
        ok: true,
        status: browserSyncStatus(),
      }),
      testConnection: async () => ({ ok: false, error: WEB_UNSUPPORTED }),
      setR2Config: async () => browserSyncStatus(),
      setR2SecretAccessKey: async () => {},
      onChanged: () => () => {},
    },
    updater: {
      check: async () => {},
      getStatus: async () => IDLE_UPDATE_STATUS,
      downloadAndInstall: async () => {},
      onStatus: () => () => {},
    },
  };
}
