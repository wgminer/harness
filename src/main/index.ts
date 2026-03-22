import { app, BrowserWindow, ipcMain, Menu, nativeImage, dialog, nativeTheme, globalShortcut, Tray } from "electron";
import { join } from "path";
import { registerSettingsHandlers } from "./settings";
import { registerMemoryHandlers } from "./memory";
import { registerChatHandlers } from "./chat";
import { registerCustomizationHandlers } from "./customization";
import { registerFileToolsHandlers } from "./fileTools";
import { registerAssistantToolsHandlers } from "./assistantTools";
import { registerPlansHandlers } from "./plans";
import { registerRecordingHandlers } from "./recording";
import { importFromFolder } from "./importChatGPT";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const iconPath = join(app.getAppPath(), "resources", "icon.png");

const LARGE_WIDTH = 1024;
const LARGE_HEIGHT = 768;
const SMALL_WIDTH = 800;
const SMALL_HEIGHT = 600;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: LARGE_WIDTH,
    height: LARGE_HEIGHT,
    icon: nativeImage.createFromPath(iconPath),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.webContents.on("context-menu", (_event, params) => {
    const menu = Menu.buildFromTemplate([
      {
        label: "Inspect Element",
        click: () => {
          mainWindow?.webContents.inspectElement(params.x, params.y);
          mainWindow?.webContents.openDevTools();
        },
      },
    ]);
    menu.popup({ window: mainWindow!, x: params.x, y: params.y });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function isSmallSize(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const [w] = mainWindow.getSize();
  return w <= SMALL_WIDTH;
}

ipcMain.handle("app:getVersion", () => app.getVersion());

ipcMain.handle("window:getSize", (): "small" | "large" => {
  return isSmallSize() ? "small" : "large";
});

ipcMain.handle("window:toggleSize", (): "small" | "large" => {
  if (!mainWindow || mainWindow.isDestroyed()) return "large";
  if (isSmallSize()) {
    mainWindow.setSize(LARGE_WIDTH, LARGE_HEIGHT);
    return "large";
  } else {
    mainWindow.setSize(SMALL_WIDTH, SMALL_HEIGHT);
    return "small";
  }
});

ipcMain.handle("memory:importFromChatGPTFolder", async () => {
  const win = BrowserWindow.getAllWindows()[0] ?? null;
  const result = await dialog.showOpenDialog(win ?? undefined, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: 0, errors: [] as string[] };
  }
  return importFromFolder(result.filePaths[0]);
});

app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  registerSettingsHandlers();
  registerMemoryHandlers();
  registerPlansHandlers();
  registerChatHandlers();
  registerCustomizationHandlers();
  registerFileToolsHandlers();
  registerAssistantToolsHandlers();
  registerRecordingHandlers();

  if (process.platform === "darwin") {
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }

  createWindow();

  const trayIconPath = join(app.getAppPath(), "resources", "icon-tray.png");
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 18, height: 18 });
  trayIcon.setTemplateImage(true);

  const trayRecordingIconPath = join(app.getAppPath(), "resources", "icon-tray-recording.png");
  const trayRecordingIcon = nativeImage.createFromPath(trayRecordingIconPath).resize({ width: 18, height: 18 });

  tray = new Tray(trayIcon);
  tray.setToolTip("Harness");
  tray.setTitle(" {READY}");

  ipcMain.handle("recording:done", () => {
    tray?.setImage(trayIcon);
    tray?.setTitle(" {READY}");
    globalShortcut.unregister("Escape");
  });

  let globalRecording = false;

  function registerEscapeCancel() {
    if (globalShortcut.isRegistered("Escape")) return;
    globalShortcut.register("Escape", () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return;
      globalRecording = false;
      tray?.setImage(trayIcon);
      tray?.setTitle(" {READY}");
      globalShortcut.unregister("Escape");
      win.webContents.send("recording:cancel");
    });
  }

  globalShortcut.register("CommandOrControl+Shift+Space", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (!globalRecording) {
      globalRecording = true;
      tray?.setImage(trayRecordingIcon);
      tray?.setTitle(" {REC}");
      registerEscapeCancel();
      win.webContents.send("recording:startSilent");
    } else {
      globalRecording = false;
      tray?.setImage(trayIcon);
      tray?.setTitle(" {PROCESSING}");
      const wasFocused = win.isFocused();
      win.webContents.send("recording:stopAndPaste", wasFocused);
      if (wasFocused) {
        if (process.platform === "darwin") {
          app.focus({ steal: true });
        }
        win.show();
        win.focus();
      }
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
