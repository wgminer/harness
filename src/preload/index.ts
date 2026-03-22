import { contextBridge, ipcRenderer } from "electron";
import type { AppendMessageMeta } from "../shared/types";

contextBridge.exposeInMainWorld("electron", {
  app: {
    getVersion: () => ipcRenderer.invoke("app:getVersion") as Promise<string>,
  },
  windowSize: {
    get: () => ipcRenderer.invoke("window:getSize") as Promise<"small" | "large">,
    toggle: () => ipcRenderer.invoke("window:toggleSize") as Promise<"small" | "large">,
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (partial: unknown) => ipcRenderer.invoke("settings:set", partial),
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
    resetStoredData: () => ipcRenderer.invoke("memory:resetStoredData"),
    setConversationTitle: (conversationId: string, title: string) =>
      ipcRenderer.invoke("memory:setConversationTitle", conversationId, title),
    setVoiceDictationTitle: (conversationId: string) =>
      ipcRenderer.invoke("memory:setVoiceDictationTitle", conversationId) as Promise<string>,
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
    create: (title: string, status?: string) => ipcRenderer.invoke("tasks:create", title, status),
    update: (payload: { id: string; title?: string; status?: string }) =>
      ipcRenderer.invoke("tasks:update", payload),
    delete: (id: string) => ipcRenderer.invoke("tasks:delete", id),
    clearCompleted: () => ipcRenderer.invoke("tasks:clearCompleted"),
  },
  chat: {
    send: (conversationId: string, userContent: string) => ipcRenderer.invoke("chat:send", conversationId, userContent),
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
  customization: {
    getActiveTheme: () => ipcRenderer.invoke("customization:getActiveTheme"),
    setTheme: (cssContent: string) => ipcRenderer.invoke("customization:setTheme", cssContent),
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
  recording: {
    saveWav: (data: ArrayBuffer) =>
      ipcRenderer.invoke("recording:saveWav", data) as Promise<{ path: string }>,
    showInFolder: (path: string) =>
      ipcRenderer.invoke("recording:showInFolder", path) as Promise<void>,
    exportWav: (data: ArrayBuffer, suggestedName?: string) =>
      ipcRenderer.invoke("recording:exportWav", data, suggestedName) as Promise<{ path: string } | { cancelled: true }>,
    openFolder: () =>
      ipcRenderer.invoke("recording:openFolder") as Promise<void>,
    transcribe: (data: ArrayBuffer) =>
      ipcRenderer.invoke("recording:transcribe", data) as Promise<{ text: string } | { error: string }>,
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
});
