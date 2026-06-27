import { app, BrowserWindow, globalShortcut, ipcMain, nativeImage, Tray } from "electron";
import type { NativeImage } from "electron";
import { join } from "path";
import { FnMonitorProcess, resolveFnMonitorPath } from "./fnMonitorProcess";
import {
  createInitialFnRecordingState,
  reduceFnEdge,
  reduceEscape,
  type FnRecordingState,
  type GlobalRecordingEffect,
} from "./globalRecordingSession";
import { isGlobalHotkeyDisabled, isHarnessE2E } from "./e2eStub";

export interface GlobalRecordingConfig {
  appDisplayName: string;
  isDevBuild: boolean;
}

interface GlobalRecordingTrayRefs {
  tray: Tray;
  trayIcon: NativeImage;
  trayRecordingIcon: NativeImage;
  trayProcessingIcon: NativeImage;
}

let config: GlobalRecordingConfig | null = null;
let trayRefs: GlobalRecordingTrayRefs | null = null;
let fnState: FnRecordingState = createInitialFnRecordingState();
let fnMonitor: FnMonitorProcess | null = null;
/** When false, Fn is ignored while the Harness window is focused (e.g. Notes, Settings). */
let globalRecordingEnabled = true;
let hotkeyActive = false;

function appResourcePath(fileName: string): string {
  return join(app.getAppPath(), "resources", fileName);
}

function createTrayRefs(): GlobalRecordingTrayRefs {
  if (!config) throw new Error("Global recording config missing");
  const trayIconPath = appResourcePath(config.isDevBuild ? "icon-tray-dev.png" : "icon-tray.png");
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 18, height: 18 });
  trayIcon.setTemplateImage(!config.isDevBuild);

  const trayRecordingIconPath = appResourcePath("icon-tray-recording.png");
  const trayRecordingIcon = nativeImage.createFromPath(trayRecordingIconPath).resize({ width: 18, height: 18 });
  const trayProcessingIconPath = appResourcePath("icon-tray-processing.png");
  const trayProcessingIcon = nativeImage.createFromPath(trayProcessingIconPath).resize({ width: 18, height: 18 });

  const tray = new Tray(trayIcon);
  tray.setToolTip(config.appDisplayName);
  tray.setTitle("");
  return { tray, trayIcon, trayRecordingIcon, trayProcessingIcon };
}

function setReadyTray(): void {
  if (!trayRefs) return;
  trayRefs.tray.setImage(trayRefs.trayIcon);
  trayRefs.tray.setTitle("");
}

function setRecordingTray(): void {
  if (!trayRefs) return;
  trayRefs.tray.setImage(trayRefs.trayRecordingIcon);
  trayRefs.tray.setTitle(" REC");
}

function setProcessingTray(): void {
  if (!trayRefs) return;
  trayRefs.tray.setImage(trayRefs.trayProcessingIcon);
  trayRefs.tray.setTitle("");
}

function registerEscapeCancel(): void {
  if (globalShortcut.isRegistered("Escape")) return;
  globalShortcut.register("Escape", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    const { next, effects } = reduceEscape(fnState);
    fnState = next;
    for (const e of effects) {
      if (e.kind === "cancelRecording") {
        setReadyTray();
        globalShortcut.unregister("Escape");
        win.webContents.send("recording:cancel");
      }
    }
  });
}

function applyEffects(effects: GlobalRecordingEffect[]): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  for (const e of effects) {
    if (e.kind === "startRecording") {
      setRecordingTray();
      registerEscapeCancel();
      win.webContents.send("recording:startSilent");
    } else if (e.kind === "stopRecording") {
      setProcessingTray();
      globalShortcut.unregister("Escape");
      // Playwright often leaves isFocused() false; E2E must use the in-app path (not pasteText/AppleScript).
      const wasFocused = isHarnessE2E() ? true : win.isFocused();
      win.webContents.send("recording:stopAndPaste", wasFocused);
      if (wasFocused) {
        if (process.platform === "darwin") {
          app.focus({ steal: true });
        }
        win.show();
        win.focus();
      }
    } else if (e.kind === "cancelRecording") {
      setReadyTray();
      globalShortcut.unregister("Escape");
      win.webContents.send("recording:cancel");
    }
  }
}

function onFnEdge(phase: "down" | "up", ms: number): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  const focusedInApp = isHarnessE2E() ? true : win.isFocused();
  if (focusedInApp && !globalRecordingEnabled) return;

  const { next, effects } = reduceFnEdge(fnState, phase, ms);
  fnState = next;
  applyEffects(effects);
}

function startFnMonitor(): void {
  if (!trayRefs || fnMonitor || process.platform !== "darwin" || isHarnessE2E() || isGlobalHotkeyDisabled()) {
    return;
  }

  const path = resolveFnMonitorPath();
  if (path) {
    fnMonitor = new FnMonitorProcess(path, {
      onEdge: onFnEdge,
      onExit: (code) => {
        console.warn(`HarnessFnMonitor exited with code ${code}, restarting…`);
      },
    });
    fnMonitor.start();
  } else {
    trayRefs.tray.setToolTip("Harness (Fn monitor missing — run npm run build:fn-monitor)");
    trayRefs.tray.setTitle(" {!FN}");
  }
}

function stopFnMonitor(): void {
  fnMonitor?.dispose();
  fnMonitor = null;
}

function cancelActiveRecording(): void {
  if (fnState.session === "none") return;
  const { next, effects } = reduceEscape(fnState);
  fnState = next;
  applyEffects(effects);
}

function destroyTray(): void {
  stopFnMonitor();
  cancelActiveRecording();
  globalShortcut.unregister("Escape");
  trayRefs?.tray.destroy();
  trayRefs = null;
}

function startTrayAndMonitor(): void {
  if (!config || trayRefs || process.platform !== "darwin" || isHarnessE2E()) return;
  trayRefs = createTrayRefs();
  startFnMonitor();
}

/**
 * macOS: Fn key via HarnessFnMonitor; E2E: `e2e:injectFnEvent`.
 * Registers `recording:done` escape cleanup and Escape-while-recording.
 */
export function registerGlobalFnRecording(recordingConfig: GlobalRecordingConfig): void {
  config = recordingConfig;

  ipcMain.handle("recording:setGlobalEnabled", (_e, enabled: boolean) => {
    globalRecordingEnabled = enabled;
    if (!enabled && fnState.session !== "none") {
      cancelActiveRecording();
    }
  });

  ipcMain.handle("recording:done", () => {
    setReadyTray();
    globalShortcut.unregister("Escape");
  });

  if (isHarnessE2E()) {
    ipcMain.handle("e2e:injectFnEvent", (_e, phase: "down" | "up", ms?: number) => {
      const t = typeof ms === "number" ? ms : Date.now();
      onFnEdge(phase, t);
    });
  }

  if (process.platform !== "darwin" && !isHarnessE2E()) {
    console.warn("Harness: global Fn recording is only available on macOS.");
  }

  app.on("will-quit", () => {
    destroyTray();
  });
}

/** Apply the user setting: create or remove the menu bar icon and Fn monitor. */
export async function applyGlobalFnHotkeySetting(userEnabled: boolean): Promise<void> {
  const shouldEnable = userEnabled && !isGlobalHotkeyDisabled();

  if (shouldEnable) {
    if (!hotkeyActive) {
      startTrayAndMonitor();
      hotkeyActive = true;
    }
    return;
  }

  if (hotkeyActive) {
    destroyTray();
    hotkeyActive = false;
  }
}
