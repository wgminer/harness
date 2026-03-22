import { BrowserWindow } from "electron";

export function notifyConversationTitleUpdated(conversationId: string): void {
  const win = BrowserWindow.getAllWindows()[0];
  win?.webContents.send("chat:conversationTitleUpdated", conversationId);
}
