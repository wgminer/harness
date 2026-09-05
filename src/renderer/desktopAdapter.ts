import { invoke } from "@tauri-apps/api/core";
import type { HarnessAPI } from "../shared/desktopAPI";
import type { GlobalRecordingStatus } from "../shared/desktopAPI";
import type {
  AppendMessageMeta,
  ContextPreview,
  RecordingLink,
  SystemPromptPreview,
} from "../shared/types";
import type {
  NoteEditProposalInput,
  NoteSpellCheckInput,
} from "../shared/writing";
import type { ImageGenerateInput } from "../shared/images";
import type { SyncResult, SyncStatus } from "../shared/sync";
import type { UpdateStatus } from "../shared/updateStatus";
import { tauriCommandName, tauriEventName } from "../shared/ipcNames";
import { subscribeToWire } from "./tauriEventHub";

const cmd = tauriCommandName;
const evt = tauriEventName;

function subscribe<T>(
  eventName: string,
  handler: (payload: T) => void,
): () => void {
  return subscribeToWire(evt(eventName), handler);
}

export function createHarnessAdapter(): HarnessAPI {
  return {
    app: {
      getVersion: () => invoke<string>(cmd("app:getVersion")),
    },
    env: {
      isHarnessE2E: () => invoke<boolean>(cmd("env:isHarnessE2E")),
      isHarnessDev: () => invoke<boolean>(cmd("env:isHarnessDev")),
      isStubImages: () => invoke<boolean>(cmd("env:isStubImages")),
      isHarnessWeb: () => Promise.resolve(false),
    },
    system: {
      getPlatform: () => invoke<NodeJS.Platform>(cmd("system:getPlatform")),
      macosAccessibilityTrusted: () =>
        invoke<boolean>(cmd("system:macosAccessibilityTrusted")),
      requestAccessibilityPrompt: () =>
        invoke<boolean>(cmd("system:requestAccessibilityPrompt")),
      openAccessibilitySettings: () =>
        invoke<void>(cmd("system:openAccessibilitySettings")),
      openMicrophoneSettings: () =>
        invoke<void>(cmd("system:openMicrophoneSettings")),
      openSpeechRecognitionSettings: () =>
        invoke<void>(cmd("system:openSpeechRecognitionSettings")),
    },
    settings: {
      get: () => invoke(cmd("settings:get")),
      set: (partial: unknown) => invoke(cmd("settings:set"), { partial }),
      getSystemPromptPreview: (platform: "desktop" | "ios", chatMode?: string) =>
        invoke<SystemPromptPreview>(cmd("settings:getSystemPromptPreview"), {
          platform,
          chatMode: chatMode ?? null,
        }),
    },
    credentials: {
      getStatus: () => invoke(cmd("credentials:getStatus")),
      getSecretsForSettings: () => invoke(cmd("credentials:getSecretsForSettings")),
      setOpenAIApiKey: (value: string) =>
        invoke(cmd("credentials:setOpenAIApiKey"), { value }),
      setTavilyApiKey: (value: string) =>
        invoke(cmd("credentials:setTavilyApiKey"), { value }),
      setR2SecretAccessKey: (value: string) =>
        invoke(cmd("credentials:setR2SecretAccessKey"), { value }),
    },
    memory: {
      createConversation: (chatMode?: string) =>
        invoke<string>(cmd("memory:createConversation"), {
          chatMode: chatMode ?? null,
        }),
      getConversation: (id: string) =>
        invoke(cmd("memory:getConversation"), { id }),
      listConversations: () => invoke(cmd("memory:listConversations")),
      deleteConversation: (conversationId: string) =>
        invoke(cmd("memory:deleteConversation"), { conversationId }),
      setConversationChatMode: (conversationId: string, chatMode: string) =>
        invoke(cmd("memory:setConversationChatMode"), { conversationId, chatMode }),
      getMessages: (conversationId: string) =>
        invoke(cmd("memory:getMessages"), { conversationId }),
      appendMessage: (
        conversationId: string,
        role: string,
        content: string,
        meta?: AppendMessageMeta,
      ) =>
        invoke(cmd("memory:appendMessage"), {
          conversationId,
          role,
          content,
          meta,
        }),
      getUserMemory: () => invoke(cmd("memory:getUserMemory")),
      setUserMemory: (key: string, value: string) =>
        invoke(cmd("memory:setUserMemory"), { key, value }),
      deleteUserMemoryKey: (key: string) =>
        invoke(cmd("memory:deleteUserMemoryKey"), { key }),
      searchConversations: (query: string, composeFirstOnly?: boolean) =>
        invoke(cmd("memory:searchConversations"), { query, composeFirstOnly }),
      importFromChatGPTFolder: () =>
        invoke(cmd("memory:importFromChatGPTFolder")),
      previewClaudeImport: () => invoke(cmd("memory:previewClaudeImport")),
      confirmClaudeImport: (folderPath: string, claudeIds?: string[]) =>
        invoke(cmd("memory:confirmClaudeImport"), { folderPath, claudeIds }),
      importLlmContext: (exportText: string) =>
        invoke(cmd("memory:importLlmContext"), { exportText }),
      openAppDataFolder: () => invoke(cmd("memory:openAppDataFolder")),
      getDataStatus: () => invoke(cmd("memory:getDataStatus")),
      cleanupLegacyMemory: () => invoke(cmd("memory:cleanupLegacyMemory")),
      setConversationTitle: (conversationId: string, title: string) =>
        invoke(cmd("memory:setConversationTitle"), { conversationId, title }),
      markVoiceDictationSession: (conversationId: string) =>
        invoke<string>(cmd("memory:markVoiceDictationSession"), { conversationId }),
      linkDictationRecording: (conversationId: string, path: string) =>
        invoke(cmd("memory:linkDictationRecording"), { conversationId, path }),
      getConversationRecordings: (conversationId: string) =>
        invoke<{ recordings: RecordingLink[] }>(cmd("memory:getConversationRecordings"), {
          conversationId,
        }),
    },
    tasks: {
      list: () => invoke(cmd("tasks:list")),
      create: (title: string, tags?: string[], status?: string) =>
        invoke(cmd("tasks:create"), { title, tags, status }),
      update: (payload: {
        id: string;
        title?: string;
        status?: string;
        tags?: string[];
        add_tags?: string[];
        remove_tags?: string[];
      }) => invoke(cmd("tasks:update"), { payload }),
      delete: (id: string) => invoke(cmd("tasks:delete"), { id }),
      clearCompleted: () => invoke(cmd("tasks:clearCompleted")),
    },
    chat: {
      send: (conversationId: string, userContent: string) =>
        invoke(cmd("chat:send"), { conversationId, userContent }),
      polishLastUser: (conversationId: string) =>
        invoke(cmd("chat:polishLastUser"), { conversationId }),
      generateReply: (conversationId: string) =>
        invoke(cmd("chat:generateReply"), { conversationId }),
      ensureDictationReplyAction: (conversationId: string) =>
        invoke<string>(cmd("chat:ensureDictationReplyAction"), { conversationId }),
      stop: () => invoke(cmd("chat:stop")),
      resolveGatedTool: (pendingId: string, action: "proceed" | "cancel") =>
        invoke(cmd("chat:resolveGatedTool"), { pendingId, action }),
      getContextPreview: (conversationId?: string | null) =>
        invoke<ContextPreview>(cmd("chat:getContextPreview"), {
          conversationId: conversationId ?? null,
        }),
      onStreamChunk: (cb) =>
        subscribe<{ conversationId: string; chunk: string }>(
          "chat:streamChunk",
          (p) => cb(p.conversationId, p.chunk),
        ),
      onStreamEnd: (cb) =>
        subscribe<{ conversationId: string }>("chat:streamEnd", (p) =>
          cb(p.conversationId),
        ),
      onNoteStreamOpen: (cb) =>
        subscribe<{ conversationId: string; noteId: string; title: string; summary: string }>(
          "chat:noteStreamOpen",
          (p) => cb(p.conversationId, p.noteId, p.title, p.summary),
        ),
      onNoteStreamChunk: (cb) =>
        subscribe<{ conversationId: string; noteId: string; chunk: string }>(
          "chat:noteStreamChunk",
          (p) => cb(p.conversationId, p.noteId, p.chunk),
        ),
      onNoteStreamClose: (cb) =>
        subscribe<{ conversationId: string; noteId: string }>("chat:noteStreamClose", (p) =>
          cb(p.conversationId, p.noteId),
        ),
      onToolPanelUpdate: (cb) =>
        subscribe<{ conversationId: string; toolName: string; payload: unknown }>(
          "chat:toolPanelUpdate",
          (p) => cb(p.conversationId, p.toolName, p.payload),
        ),
      onConversationTitleUpdated: (cb) =>
        subscribe<{ conversationId: string }>(
          "chat:conversationTitleUpdated",
          (p) => cb(p.conversationId),
        ),
      onTitleGenerationStarted: (cb) =>
        subscribe<{ conversationId: string }>(
          "chat:titleGenerationStarted",
          (p) => cb(p.conversationId),
        ),
      onTitleGenerationEnded: (cb) =>
        subscribe<{ conversationId: string }>(
          "chat:titleGenerationEnded",
          (p) => cb(p.conversationId),
        ),
      onDictationReplyActionUpdated: (cb) =>
        subscribe<{ conversationId: string; action: string }>(
          "chat:dictationReplyActionUpdated",
          (p) => cb(p.conversationId, p.action),
        ),
    },
    uiSession: {
      get: () => invoke(cmd("uiSession:get")),
      set: (partial: unknown) => invoke(cmd("uiSession:set"), { partial }),
    },
    customization: {
      getLayoutOptions: () => invoke(cmd("customization:getLayoutOptions")),
      setLayout: (options: unknown) =>
        invoke(cmd("customization:setLayout"), { options }),
      onUpdated: (cb) =>
        subscribe<{ type: string }>("customization:updated", (p) => cb(p)),
    },
    fileTools: {
      getAllowedRoots: () => invoke<string[]>(cmd("fileTools:getAllowedRoots")),
    },
    search: {
      lookupImage: (query: string) =>
        invoke(cmd("search:lookupImage"), { query }),
    },
    notes: {
      list: () => invoke(cmd("notes:list")),
      create: (title?: string, content?: string) =>
        invoke(cmd("notes:create"), { title, content }),
      read: (id: string) => invoke(cmd("notes:read"), { id }),
      save: (id: string, content: string) =>
        invoke(cmd("notes:save"), { id, content }),
      delete: (id: string) => invoke(cmd("notes:delete"), { id }),
      showInFolder: (id: string) => invoke(cmd("notes:showInFolder"), { id }),
      proposeEdit: (input: NoteEditProposalInput) =>
        invoke(cmd("notes:proposeEdit"), { input }),
      spellCheck: (input: NoteSpellCheckInput) =>
        invoke(cmd("notes:spellCheck"), { input }),
      print: (html: string, jobName?: string) =>
        invoke(cmd("notes:print"), { html, jobName }),
      openSticky: (noteId: string) => invoke(cmd("notes:openSticky"), { noteId }),
      setStickyPinned: (noteId: string, pinned: boolean) =>
        invoke(cmd("notes:setStickyPinned"), { noteId, pinned }),
      setStickyTitle: (noteId: string, title: string) =>
        invoke(cmd("notes:setStickyTitle"), { noteId, title }),
      popInSticky: (noteId: string) => invoke(cmd("notes:popInSticky"), { noteId }),
      onOpenInMain: (cb) =>
        subscribeToWire<{ noteId: string }>(evt("notes:openInMain"), (payload) => {
          if (payload?.noteId) cb(payload.noteId);
        }),
    },
    images: {
      list: () => invoke(cmd("images:list")),
      read: (id: string) => invoke(cmd("images:read"), { id }),
      delete: (id: string) => invoke(cmd("images:delete"), { id }),
      generate: (input: ImageGenerateInput) =>
        invoke(cmd("images:generate"), { input }),
      setActiveVersion: (id: string, versionId: string) =>
        invoke(cmd("images:setActiveVersion"), { id, versionId }),
    },
    recording: {
      signalFrontendReady: () => invoke(cmd("recording:signalFrontendReady")),
      requestMicrophoneAccess: () =>
        invoke<boolean>(cmd("recording:requestMicrophoneAccess")),
      microphonePermissionStatus: () =>
        invoke<"granted" | "denied" | "undetermined" | "unsupported">(
          cmd("recording:microphonePermissionStatus")
        ),
      saveWav: (data: ArrayBuffer) =>
        invoke<{ path: string }>(cmd("recording:saveWav"), data),
      stageDroppedAudio: (path: string) =>
        invoke<{ path: string; name: string }>(cmd("recording:stageDroppedAudio"), { path }),
      showInFolder: (path: string) =>
        invoke(cmd("recording:showInFolder"), { path }),
      exportWav: (data: ArrayBuffer, suggestedName?: string) =>
        invoke(cmd("recording:exportWav"), { data, suggestedName }),
      openFolder: () => invoke(cmd("recording:openFolder")),
      countFiles: () => invoke<number>(cmd("recording:countFiles")),
      archiveStats: () =>
        invoke<{ fileCount: number; durationMs: number }>(cmd("recording:archiveStats")),
      transcribe: (data: ArrayBuffer, options?: { requestId?: string }) =>
        invoke(cmd("recording:transcribe"), { data, requestId: options?.requestId }),
      cancelTranscription: (requestId: string) =>
        invoke(cmd("recording:cancelTranscription"), { requestId }),
      pasteText: (text: string) => invoke(cmd("recording:pasteText"), { text }),
      getGlobalStatus: () =>
        invoke<GlobalRecordingStatus>(cmd("recording:getGlobalStatus")),
      retryGlobalTranscription: (path: string) =>
        invoke(cmd("recording:retryGlobalTranscription"), { path }),
      cancelGlobalTranscription: () =>
        invoke(cmd("recording:cancelGlobalTranscription")),
      cancelGlobalSession: () => invoke(cmd("recording:cancelGlobalSession")),
      stopGlobalRecording: () => invoke(cmd("recording:stopGlobalRecording")),
      onGlobalRecordingStarted: (cb) =>
        subscribeToWire<{ focused?: boolean }>("global-recording-started", (p) =>
          cb({ focused: p?.focused === true }),
        ),
      onGlobalRecordingStopped: (cb) =>
        subscribeToWire<Record<string, never>>("global-recording-stopped", () => cb()),
      onGlobalRecordingTranscribing: (cb) =>
        subscribeToWire<{ recordingPath?: string }>("global-recording-transcribing", (p) =>
          cb({
            recordingPath:
              typeof p?.recordingPath === "string" && p.recordingPath.length > 0
                ? p.recordingPath
                : undefined,
          }),
        ),
      onGlobalRecordingCancelled: (cb) =>
        subscribeToWire<Record<string, never>>("global-recording-cancelled", () => cb()),
      onGlobalRecordingError: (cb) =>
        subscribeToWire<{ message?: string; recordingPath?: string }>(
          "global-recording-error",
          (p) =>
            cb({
              message: p?.message ?? "Recording failed.",
              recordingPath:
                typeof p?.recordingPath === "string" && p.recordingPath.length > 0
                  ? p.recordingPath
                  : undefined,
            }),
        ),
      onGlobalRecordingLevel: (cb) =>
        subscribeToWire<{ level?: number }>("global-recording-level", (p) => {
          const level = typeof p?.level === "number" && Number.isFinite(p.level) ? p.level : 0;
          cb(Math.min(1, Math.max(0, level)));
        }),
      onGlobalTranscriptReady: (cb) =>
        subscribeToWire<{ text?: string }>("global-transcript-ready", (p) =>
          cb(p?.text ?? ""),
        ),
      onGlobalTranscriptDelivered: (cb) =>
        subscribeToWire<{ conversationId?: string }>("global-transcript-delivered", (p) => {
          if (p?.conversationId) cb(p.conversationId);
        }),
    },
    weather: {
      getCurrent: () =>
        invoke<{
          tempF: number;
          place: string;
          state: string;
          zip: string;
          weather: string;
          label: string;
        }>(cmd("weather:getCurrent")),
    },
    sync: {
      getStatus: () => invoke<SyncStatus>(cmd("sync:getStatus")),
      runNow: () => invoke<SyncResult>(cmd("sync:runNow")),
      testConnection: () => invoke(cmd("sync:testConnection")),
      setR2Config: (partial: {
        accountId?: string;
        bucket?: string;
        prefix?: string;
        accessKeyId?: string;
      }) => invoke(cmd("sync:setR2Config"), { partial }),
      setR2SecretAccessKey: (secret: string) =>
        invoke(cmd("sync:setR2SecretAccessKey"), { secret }),
      onChanged: (cb) =>
        subscribe<Record<string, never>>("sync:changed", () => cb()),
    },
    updater: {
      check: () => invoke(cmd("updater:check")),
      getStatus: () => invoke<UpdateStatus>(cmd("updater:getStatus")),
      downloadAndInstall: () => invoke(cmd("updater:downloadAndInstall")),
      onStatus: (cb) =>
        subscribe<UpdateStatus>("updater:status", (status) => cb(status)),
    },
    e2e: {
      injectFnEvent: (phase: "down" | "up", ms?: number) =>
        invoke(cmd("e2e:injectFnEvent"), { phase, ms }),
    },
  };
}
