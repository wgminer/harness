import { app, BrowserWindow, ipcMain } from "electron";
import { autoUpdater } from "electron-updater";
import { isHarnessDev, isHarnessE2E } from "./e2eStub";
import { IDLE_UPDATE_STATUS, type UpdateStatus } from "../shared/updateStatus";

let currentStatus: UpdateStatus = IDLE_UPDATE_STATUS;

function isUpdaterEnabled(): boolean {
  return app.isPackaged && !isHarnessDev() && !isHarnessE2E();
}

function broadcastStatus(status: UpdateStatus): void {
  currentStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("updater:status", status);
    }
  }
}

export function registerUpdaterHandlers(): void {
  ipcMain.handle("updater:check", async () => {
    if (!isUpdaterEnabled()) return;
    await autoUpdater.checkForUpdates();
  });

  ipcMain.handle("updater:getStatus", () => currentStatus);

  ipcMain.handle("updater:downloadAndInstall", async () => {
    if (!isUpdaterEnabled()) return;
    await autoUpdater.downloadUpdate();
  });

  if (!isUpdaterEnabled()) return;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("checking-for-update", () => {
    broadcastStatus({ status: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    broadcastStatus({ status: "available", version: info.version });
  });

  autoUpdater.on("update-not-available", () => {
    broadcastStatus({ status: "not-available" });
  });

  autoUpdater.on("download-progress", (progress) => {
    broadcastStatus({ status: "downloading", percent: Math.round(progress.percent) });
  });

  autoUpdater.on("update-downloaded", () => {
    broadcastStatus({ status: "ready" });
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on("error", (error) => {
    broadcastStatus({ status: "error", message: error.message });
  });
}

export function startUpdateCheck(): void {
  if (!isUpdaterEnabled()) return;
  void autoUpdater.checkForUpdates();
}
