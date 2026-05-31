import { contextBridge, ipcRenderer } from "electron";
import type { AppendMessageMeta } from "../shared/types";
import type { UsageStatsSnapshot } from "../shared/usageStats";
import type { NoteEditProposal, NoteEditProposalInput } from "../shared/writing";
import type { SyncFolderSuggestion, SyncResult, SyncStatus } from "../shared/sync";

const e2eBridge =
  process.env.HARNESS_E2E === "1"
    ? {
        injectFnEvent: (phase: "down" | "up", ms?: number) =>
          ipcRenderer.invoke("e2e:injectFnEvent", phase, ms) as Promise<void>,
      }
    : undefined;

contextBridge.exposeInMainWorld("electron", {
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>,
  },
  /** Main process is source of truth (Playwright sets env on the Electron process). */
  env: {
    isHarnessE2E: () => ipcRenderer.invoke("env:isHarnessE2E") as Promise<boolean>,
  },
  system: {
    getPlatform: () => ipcRenderer.invoke("system:getPlatform") as Promise<NodeJS.Platform>,
    macosAccessibilityTrusted: () =>
      ipcRenderer.invoke("system:macosAccessibilityTrusted") as Promise<boolean>,
    requestAccessibilityPrompt: () =>
      ipcRenderer.invoke("system:requestAccessibilityPrompt") as Promise<boolean>,
    openAccessibilitySettings: () =>
      ipcRenderer.invoke("system:openAccessibilitySettings") as Promise<void>,
  },
  windowSize: {
    get: () => ipcRenderer.invoke("window:getSize") as Promise<"small" | "large">,
    toggle: () => ipcRenderer.invoke("window:toggleSize") as Promise<"small" | "large">,
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (partial: unknown) => ipcRenderer.invoke("settings:set", partial),
  },
  usage: {
    getStats: () => ipcRenderer.invoke("usage:getStats") as Promise<UsageStatsSnapshot>,
    reset: () => ipcRenderer.invoke("usage:reset") as Promise<UsageStatsSnapshot>,
    openOpenAIDashboard: () => ipcRenderer.invoke("usage:openOpenAIDashboard") as Promise<void>,
  },
  memory: {
    createConversation: () => ipcRenderer.invoke("memory:createConversation"),
    getConversation: (id: string) => ipcRenderer.invoke("memory:getConversation", id),
    listConversations: () => ipcRenderer.invoke("memory:listConversations"),
    deleteConversation: (conversationId: string) => ipcRenderer.invoke("memory:deleteConversation", conversationId),
    getMessages: (conversationId: string) => ipcRenderer.invoke("memory:getMessages", conversationId),
    appendMessage: (conversationId: string, role: string, content: string, meta?: AppendMessageMeta) =>
      ipcRenderer.invoke("memory:appendMessage", conversationId, role, content, meta),
    getUserMemory: () => ipcRenderer.invoke("memory:getUserMemory"),
    setUserMemory: (key: string, value: string) => ipcRenderer.invoke("memory:setUserMemory", key, value),
    deleteUserMemoryKey: (key: string) => ipcRenderer.invoke("memory:deleteUserMemoryKey", key),
    searchConversations: (query: string) => ipcRenderer.invoke("memory:searchConversations", query),
    importFromChatGPTFolder: () =>
      ipcRenderer.invoke("memory:importFromChatGPTFolder") as Promise<{ imported: number; errors: string[] }>,
    importFromClaudeFolder: () =>
      ipcRenderer.invoke("memory:importFromClaudeFolder") as Promise<{ imported: number; errors: string[] }>,
    importLlmContext: (exportText: string) =>
      ipcRenderer.invoke("memory:importLlmContext", exportText) as Promise<
        | {
            ok: true;
            result: { added: number; updated: number; truncated: boolean; importSource: string | null };
          }
        | { ok: false; error: string }
      >,
    runCompileNow: () =>
      ipcRenderer.invoke("memory:runCompileNow") as Promise<
        | {
            ok: true;
            result: {
              ranAt: number;
              considered: number;
              added: number;
              updated: number;
              skipped: boolean;
            };
          }
        | { ok: false; error: string }
      >,
    getCompileStatus: () =>
      ipcRenderer.invoke("memory:getCompileStatus") as Promise<{
        lastRunAt: number | null;
        lastRunDateLocal: string | null;
        lastAddedCount: number;
        lastUpdatedCount: number;
        lastConsideredCount: number;
        lastError: string | null;
      }>,
    openAppDataFolder: () => ipcRenderer.invoke("memory:openAppDataFolder") as Promise<void>,
    getDataStatus: () =>
      ipcRenderer.invoke("memory:getDataStatus") as Promise<{
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
        sync: SyncStatus;
      }>,
    cleanupLegacyMemory: () => ipcRenderer.invoke("memory:cleanupLegacyMemory") as Promise<{ removed: boolean }>,
    setConversationTitle: (conversationId: string, title: string) =>
      ipcRenderer.invoke("memory:setConversationTitle", conversationId, title),
    markVoiceDictationSession: (conversationId: string) =>
      ipcRenderer.invoke("memory:markVoiceDictationSession", conversationId) as Promise<string>,
  },
  plans: {
    list: () => ipcRenderer.invoke("plans:list"),
    create: (title: string, description: string) => ipcRenderer.invoke("plans:create", title, description),
    update: (planId: string, updates: { title?: string; description?: string }) =>
      ipcRenderer.invoke("plans:update", planId, updates),
    delete: (planId: string) => ipcRenderer.invoke("plans:delete", planId),
    addConversation: (planId: string, conversationId: string) =>
      ipcRenderer.invoke("plans:addConversation", planId, conversationId),
    removeConversation: (planId: string, conversationId: string) =>
      ipcRenderer.invoke("plans:removeConversation", planId, conversationId),
  },
  tasks: {
    list: () => ipcRenderer.invoke("tasks:list"),
    create: (title: string, tags?: string[], status?: string) =>
      ipcRenderer.invoke("tasks:create", title, tags, status),
    update: (payload: { id: string; title?: string; tags?: string[] }) =>
      ipcRenderer.invoke("tasks:update", payload),
    delete: (id: string) => ipcRenderer.invoke("tasks:delete", id),
    clearCompleted: () => ipcRenderer.invoke("tasks:clearCompleted"),
  },
  clippings: {
    list: (tag?: string) => ipcRenderer.invoke("clippings:list", tag),
    create: (content: string, tags?: string[]) => ipcRenderer.invoke("clippings:create", content, tags),
    update: (payload: { id: string; content?: string; tags?: string[] }) =>
      ipcRenderer.invoke("clippings:update", payload),
    delete: (id: string) => ipcRenderer.invoke("clippings:delete", id),
  },
  chat: {
    send: (conversationId: string, userContent: string) => ipcRenderer.invoke("chat:send", conversationId, userContent),
    polishLastUser: (conversationId: string) =>
      ipcRenderer.invoke("chat:polishLastUser", conversationId) as Promise<void>,
    generateReply: (conversationId: string) => ipcRenderer.invoke("chat:generateReply", conversationId),
    stop: () => ipcRenderer.invoke("chat:stop"),
    resolveGatedTool: (pendingId: string, action: "proceed" | "cancel") =>
      ipcRenderer.invoke("chat:resolveGatedTool", pendingId, action),
    onStreamChunk: (cb: (conversationId: string, chunk: string) => void) => {
      const sub = (_: unknown, cid: string, chunk: string) => cb(cid, chunk);
      ipcRenderer.on("chat:streamChunk", sub);
      return () => ipcRenderer.removeListener("chat:streamChunk", sub);
    },
    onStreamEnd: (cb: (conversationId: string) => void) => {
      const sub = (_: unknown, cid: string) => cb(cid);
      ipcRenderer.on("chat:streamEnd", sub);
      return () => ipcRenderer.removeListener("chat:streamEnd", sub);
    },
    onToolPanelUpdate: (cb: (conversationId: string, toolName: string, payload: unknown) => void) => {
      const sub = (_: unknown, cid: string, toolName: string, payload: unknown) => cb(cid, toolName, payload);
      ipcRenderer.on("chat:toolPanelUpdate", sub);
      return () => ipcRenderer.removeListener("chat:toolPanelUpdate", sub);
    },
    onConversationTitleUpdated: (cb: (conversationId: string) => void) => {
      const sub = (_: unknown, cid: string) => cb(cid);
      ipcRenderer.on("chat:conversationTitleUpdated", sub);
      return () => ipcRenderer.removeListener("chat:conversationTitleUpdated", sub);
    },
    onTitleGenerationStarted: (cb: (conversationId: string) => void) => {
      const sub = (_: unknown, cid: string) => cb(cid);
      ipcRenderer.on("chat:titleGenerationStarted", sub);
      return () => ipcRenderer.removeListener("chat:titleGenerationStarted", sub);
    },
    onTitleGenerationEnded: (cb: (conversationId: string) => void) => {
      const sub = (_: unknown, cid: string) => cb(cid);
      ipcRenderer.on("chat:titleGenerationEnded", sub);
      return () => ipcRenderer.removeListener("chat:titleGenerationEnded", sub);
    },
  },
  uiSession: {
    get: () => ipcRenderer.invoke("uiSession:get"),
    set: (partial: unknown) => ipcRenderer.invoke("uiSession:set", partial),
  },
  customization: {
    getActiveTheme: () => ipcRenderer.invoke("customization:getActiveTheme"),
    getThemeSettings: () => ipcRenderer.invoke("customization:getThemeSettings"),
    setThemeSettings: (settings: unknown) => ipcRenderer.invoke("customization:setThemeSettings", settings),
    getLayoutOptions: () => ipcRenderer.invoke("customization:getLayoutOptions"),
    setLayout: (options: unknown) => ipcRenderer.invoke("customization:setLayout", options),
    onUpdated: (cb: (payload: { type: string }) => void) => {
      const sub = (_: unknown, payload: { type: string }) => cb(payload);
      ipcRenderer.on("customization:updated", sub);
      return () => ipcRenderer.removeListener("customization:updated", sub);
    },
  },
  fileTools: {
    getAllowedRoots: () => ipcRenderer.invoke("fileTools:getAllowedRoots"),
  },
  notes: {
    list: () =>
      ipcRenderer.invoke("notes:list") as Promise<
        { id: string; title: string; updatedAt: number; createdAt: number }[]
      >,
    create: (title?: string, content?: string) =>
      ipcRenderer.invoke("notes:create", title, content) as Promise<{
        id: string;
        title: string;
        content: string;
        updatedAt: number;
        createdAt: number;
      }>,
    read: (id: string) =>
      ipcRenderer.invoke("notes:read", id) as Promise<{
        id: string;
        title: string;
        content: string;
        updatedAt: number;
        createdAt: number;
      } | null>,
    save: (id: string, content: string) =>
      ipcRenderer.invoke("notes:save", id, content) as Promise<{
        id: string;
        title: string;
        content: string;
        updatedAt: number;
        createdAt: number;
      }>,
    delete: (id: string) =>
      ipcRenderer.invoke("notes:delete", id) as Promise<
        { id: string; title: string; updatedAt: number; createdAt: number }[]
      >,
    showInFolder: (id: string) =>
      ipcRenderer.invoke("notes:showInFolder", id) as Promise<void>,
    proposeEdit: (input: NoteEditProposalInput) =>
      ipcRenderer.invoke("notes:proposeEdit", input) as Promise<NoteEditProposal>,
    print: (html: string, jobName?: string) =>
      ipcRenderer.invoke("notes:print", html, jobName) as Promise<{ success: boolean }>,
  },
  recording: {
    setGlobalEnabled: (enabled: boolean) =>
      ipcRenderer.invoke("recording:setGlobalEnabled", enabled) as Promise<void>,
    requestMicrophoneAccess: () =>
      ipcRenderer.invoke("recording:requestMicrophoneAccess") as Promise<boolean>,
    saveWav: (data: ArrayBuffer) =>
      ipcRenderer.invoke("recording:saveWav", data) as Promise<{ path: string }>,
    showInFolder: (path: string) =>
      ipcRenderer.invoke("recording:showInFolder", path) as Promise<void>,
    exportWav: (data: ArrayBuffer, suggestedName?: string) =>
      ipcRenderer.invoke("recording:exportWav", data, suggestedName) as Promise<{ path: string } | { cancelled: true }>,
    openFolder: () =>
      ipcRenderer.invoke("recording:openFolder") as Promise<void>,
    transcribe: (data: ArrayBuffer, options?: { requestId?: string }) =>
      ipcRenderer.invoke("recording:transcribe", data, options?.requestId) as Promise<{ text: string } | { error: string }>,
    cancelTranscription: (requestId: string) =>
      ipcRenderer.invoke("recording:cancelTranscription", requestId) as Promise<void>,
    pasteText: (text: string) =>
      ipcRenderer.invoke("recording:pasteText", text) as Promise<void>,
    done: () =>
      ipcRenderer.invoke("recording:done") as Promise<void>,
    onStartSilent: (cb: () => void) => {
      const sub = () => cb();
      ipcRenderer.on("recording:startSilent", sub);
      return () => ipcRenderer.removeListener("recording:startSilent", sub);
    },
    onStopAndPaste: (cb: (wasFocused: boolean) => void) => {
      const sub = (_: unknown, wasFocused: boolean) => cb(wasFocused);
      ipcRenderer.on("recording:stopAndPaste", sub);
      return () => ipcRenderer.removeListener("recording:stopAndPaste", sub);
    },
    onCancel: (cb: () => void) => {
      const sub = () => cb();
      ipcRenderer.on("recording:cancel", sub);
      return () => ipcRenderer.removeListener("recording:cancel", sub);
    },
  },
  sync: {
    getStatus: () => ipcRenderer.invoke("sync:getStatus") as Promise<SyncStatus>,
    runNow: () => ipcRenderer.invoke("sync:runNow") as Promise<SyncResult>,
    pickFolder: () => ipcRenderer.invoke("sync:pickFolder") as Promise<string | null>,
    setFolder: (path: string) =>
      ipcRenderer.invoke("sync:setFolder", path) as Promise<string | null>,
    revealFolder: () => ipcRenderer.invoke("sync:revealFolder") as Promise<void>,
    listSuggestions: () =>
      ipcRenderer.invoke("sync:listSuggestions") as Promise<SyncFolderSuggestion[]>,
  },
  ...(e2eBridge ? { e2e: e2eBridge } : {}),
});
