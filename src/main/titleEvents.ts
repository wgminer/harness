import { BrowserWindow } from "electron";

function mainWindow() {
  return BrowserWindow.getAllWindows()[0];
}

export function notifyConversationTitleUpdated(conversationId: string): void {
  mainWindow()?.webContents.send("chat:conversationTitleUpdated", conversationId);
}

export function notifyTitleGenerationStarted(conversationId: string): void {
  mainWindow()?.webContents.send("chat:titleGenerationStarted", conversationId);
}

export function notifyTitleGenerationEnded(conversationId: string): void {
  mainWindow()?.webContents.send("chat:titleGenerationEnded", conversationId);
}
