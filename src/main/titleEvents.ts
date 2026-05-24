import { BrowserWindow } from "electron";

function mainWindow(): BrowserWindow | undefined {
  try {
    return BrowserWindow.getAllWindows()[0];
  } catch {
    return undefined;
  }
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
