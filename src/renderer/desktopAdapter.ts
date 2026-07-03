import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { HarnessAPI } from "../shared/desktopAPI";
import type { AppendMessageMeta } from "../shared/types";
import type { NoteEditProposalInput, NoteSpellCheckInput } from "../shared/writing";
import type { SyncResult, SyncStatus } from "../shared/sync";
import type { UpdateStatus } from "../shared/updateStatus";

/** Legacy `namespace:method` IPC → Tauri camelCase command (matches #[command(rename_all = "camelCase")]) */
function cmd(name: string): string {
  const colon = name.indexOf(":");
  if (colon < 0) return name;
  const ns = name.slice(0, colon);
  const method = name.slice(colon + 1);
  return ns + method.charAt(0).toUpperCase() + method.slice(1);
}

/** Legacy `namespace:event` → Tauri kebab-case event wire name */
function evt(name: string): string {
  return name.replace(/:/g, "-");
}

function subscribe<T>(
  eventName: string,
  handler: (payload: T) => void,
): () => void {
  let unlisten: UnlistenFn | null = null;
  void listen<T>(evt(eventName), (e) => {
    handler(e.payload);
  }).then((fn) => {
    unlisten = fn;
  });
  return () => {
    void unlisten?.();
  };
}

export function createHarnessAdapter(): HarnessAPI {
  return {
    app: {
      getVersion: () => invoke<string>(cmd("app:getVersion")),
    },
    env: {
      isHarnessE2E: () => invoke<boolean>(cmd("env:isHarnessE2E")),
      isHarnessDev: () => invoke<boolean>(cmd("env:isHarnessDev")),
    },
    system: {
      getPlatform: () => invoke<NodeJS.Platform>(cmd("system:getPlatform")),
      macosAccessibilityTrusted: () =>
        invoke<boolean>(cmd("system:macosAccessibilityTrusted")),
      requestAccessibilityPrompt: () =>
        invoke<boolean>(cmd("system:requestAccessibilityPrompt")),
      openAccessibilitySettings: () =>
        invoke<void>(cmd("system:openAccessibilitySettings")),
    },
    windowSize: {
      get: () => invoke<"small" | "large">(cmd("window:getSize")),
      toggle: () => invoke<"small" | "large">(cmd("window:toggleSize")),
    },
    settings: {
      get: () => invoke(cmd("settings:get")),
      set: (partial: unknown) => invoke(cmd("settings:set"), { partial }),
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
      createConversation: () => invoke<string>(cmd("memory:createConversation")),
      getConversation: (id: string) =>
        invoke(cmd("memory:getConversation"), { id }),
      listConversations: () => invoke(cmd("memory:listConversations")),
      deleteConversation: (conversationId: string) =>
        invoke(cmd("memory:deleteConversation"), { conversationId }),
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
      importFromClaudeFolder: () =>
        invoke(cmd("memory:importFromClaudeFolder")),
      importLlmContext: (exportText: string) =>
        invoke(cmd("memory:importLlmContext"), { exportText }),
      runCompileNow: () => invoke(cmd("memory:runCompileNow")),
      getCompileStatus: () => invoke(cmd("memory:getCompileStatus")),
      openAppDataFolder: () => invoke(cmd("memory:openAppDataFolder")),
      getDataStatus: () => invoke(cmd("memory:getDataStatus")),
      cleanupLegacyMemory: () => invoke(cmd("memory:cleanupLegacyMemory")),
      setConversationTitle: (conversationId: string, title: string) =>
        invoke(cmd("memory:setConversationTitle"), { conversationId, title }),
      markVoiceDictationSession: (conversationId: string) =>
        invoke<string>(cmd("memory:markVoiceDictationSession"), { conversationId }),
    },
    plans: {
      list: () => invoke(cmd("plans:list")),
      create: (title: string, description: string) =>
        invoke(cmd("plans:create"), { title, description }),
      update: (planId: string, updates: { title?: string; description?: string }) =>
        invoke(cmd("plans:update"), { planId, updates }),
      delete: (planId: string) => invoke(cmd("plans:delete"), { planId }),
      addConversation: (planId: string, conversationId: string) =>
        invoke(cmd("plans:addConversation"), { planId, conversationId }),
      removeConversation: (planId: string, conversationId: string) =>
        invoke(cmd("plans:removeConversation"), { planId, conversationId }),
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
      stop: () => invoke(cmd("chat:stop")),
      resolveGatedTool: (pendingId: string, action: "proceed" | "cancel") =>
        invoke(cmd("chat:resolveGatedTool"), { pendingId, action }),
      onStreamChunk: (cb) =>
        subscribe<{ conversationId: string; chunk: string }>(
          "chat:streamChunk",
          (p) => cb(p.conversationId, p.chunk),
        ),
      onStreamEnd: (cb) =>
        subscribe<{ conversationId: string }>("chat:streamEnd", (p) =>
          cb(p.conversationId),
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
    },
    recording: {
      setGlobalEnabled: (enabled: boolean) =>
        invoke(cmd("recording:setGlobalEnabled"), { enabled }),
      requestMicrophoneAccess: () =>
        invoke<boolean>(cmd("recording:requestMicrophoneAccess")),
      saveWav: (data: ArrayBuffer) =>
        invoke<{ path: string }>(cmd("recording:saveWav"), data),
      showInFolder: (path: string) =>
        invoke(cmd("recording:showInFolder"), { path }),
      exportWav: (data: ArrayBuffer, suggestedName?: string) =>
        invoke(cmd("recording:exportWav"), { data, suggestedName }),
      openFolder: () => invoke(cmd("recording:openFolder")),
      transcribe: (data: ArrayBuffer, options?: { requestId?: string }) =>
        invoke(cmd("recording:transcribe"), { data, requestId: options?.requestId }),
      cancelTranscription: (requestId: string) =>
        invoke(cmd("recording:cancelTranscription"), { requestId }),
      pasteText: (text: string) => invoke(cmd("recording:pasteText"), { text }),
      done: () => invoke(cmd("recording:done")),
      onStartSilent: (cb) =>
        subscribe<Record<string, never>>("recording:startSilent", () => cb()),
      onStopAndPaste: (cb) =>
        subscribe<{ wasFocused: boolean }>("recording:stopAndPaste", (p) =>
          cb(p.wasFocused),
        ),
      onCancel: (cb) =>
        subscribe<Record<string, never>>("recording:cancel", () => cb()),
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
