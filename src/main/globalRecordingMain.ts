import { app, BrowserWindow, globalShortcut, ipcMain } from "electron";
import type { NativeImage, Tray } from "electron";
import { FnMonitorProcess, resolveFnMonitorPath } from "./fnMonitorProcess";
import {
  createInitialFnRecordingState,
  reduceFnEdge,
  reduceEscape,
  type FnRecordingState,
  type GlobalRecordingEffect,
} from "./globalRecordingSession";
import { isHarnessE2E } from "./e2eStub";

export interface GlobalRecordingTrayRefs {
  tray: Tray;
  trayIcon: NativeImage;
  trayRecordingIcon: NativeImage;
  trayProcessingIcon: NativeImage;
}

/**
 * macOS: Fn key via HarnessFnMonitor; E2E: `e2e:injectFnEvent`.
 * Registers `recording:done` escape cleanup and Escape-while-recording.
 */
export function registerGlobalFnRecording(refs: GlobalRecordingTrayRefs): void {
  const { tray, trayIcon, trayRecordingIcon, trayProcessingIcon } = refs;
  let fnState: FnRecordingState = createInitialFnRecordingState();
  let fnMonitor: FnMonitorProcess | null = null;

  function setReadyTray(): void {
    tray.setImage(trayIcon);
    tray.setTitle("");
  }

  function setRecordingTray(): void {
    tray.setImage(trayRecordingIcon);
    tray.setTitle(" REC");
  }

  function setProcessingTray(): void {
    tray.setImage(trayProcessingIcon);
    tray.setTitle("");
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
    const { next, effects } = reduceFnEdge(fnState, phase, ms);
    fnState = next;
    applyEffects(effects);
  }

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

  if (process.platform === "darwin" && !isHarnessE2E()) {
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
      tray.setToolTip("Harness (Fn monitor missing — run npm run build:fn-monitor)");
      tray.setTitle(" {!FN}");
    }
  } else if (process.platform !== "darwin") {
    console.warn("Harness: global Fn recording is only available on macOS.");
  }

  app.on("will-quit", () => {
    fnMonitor?.dispose();
  });
}
