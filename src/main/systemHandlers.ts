import { ipcMain, shell, systemPreferences } from "electron";

export function registerSystemHandlers(): void {
  ipcMain.handle("system:getPlatform", () => process.platform);

  ipcMain.handle("system:macosAccessibilityTrusted", () => {
    if (process.platform !== "darwin") return false;
    return systemPreferences.isTrustedAccessibilityClient(false);
  });

  /** Shows the system prompt to add Harness to Accessibility (if not already trusted). */
  ipcMain.handle("system:requestAccessibilityPrompt", () => {
    if (process.platform !== "darwin") return false;
    return systemPreferences.isTrustedAccessibilityClient(true);
  });

  ipcMain.handle("system:openAccessibilitySettings", async () => {
    if (process.platform !== "darwin") return;
    await shell.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
    );
  });
}
