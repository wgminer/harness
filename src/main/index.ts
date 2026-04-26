import "./e2eBootstrap";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, dialog, nativeTheme, globalShortcut, systemPreferences, Tray } from "electron";
import { isHarnessE2E } from "./e2eStub";
import { join } from "path";
import { registerSettingsHandlers } from "./settings";
import { registerUsageStatsHandlers } from "./usageStats";
import { registerMemoryHandlers } from "./memory";
import { registerChatHandlers } from "./chat";
import { registerCustomizationHandlers } from "./customization";
import { registerFileToolsHandlers } from "./fileTools";
import { registerAssistantToolsHandlers } from "./assistantTools";
import { registerPlansHandlers } from "./plans";
import { registerNotesHandlers } from "./writing";
import { registerRecordingHandlers } from "./recording";
import { registerGlobalFnRecording } from "./globalRecordingMain";
import { registerSystemHandlers } from "./systemHandlers";
import { importFromFolder } from "./importChatGPT";
import { registerSyncHandlers } from "./sync";
import {
  WINDOW_SMALL_PRESET_MAX_WIDTH_PX,
} from "../shared/windowLayout";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const iconPath = join(app.getAppPath(), "resources", "icon.png");

const LARGE_WIDTH = 1024;
const LARGE_HEIGHT = 768;
const SMALL_WIDTH = 400;
const SMALL_HEIGHT = 480;

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
    const template: Electron.MenuItemConstructorOptions[] = [];

    if (params.isEditable) {
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(process.platform === "darwin" ? ([{ role: "pasteAndMatchStyle" }] as const) : []),
        { type: "separator" },
        { role: "selectAll" }
      );
    } else {
      template.push({ role: "copy" }, { type: "separator" }, { role: "selectAll" });
    }

    template.push(
      { type: "separator" },
      {
        label: "Inspect element",
        click: () => {
          mainWindow?.webContents.inspectElement(params.x, params.y);
          mainWindow?.webContents.openDevTools();
        },
      }
    );

    Menu.buildFromTemplate(template).popup({ window: mainWindow!, x: params.x, y: params.y });
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function isSmallSize(): boolean {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const [w] = mainWindow.getSize();
  return w <= WINDOW_SMALL_PRESET_MAX_WIDTH_PX;
}

ipcMain.handle("app:getVersion", () => app.getVersion());

ipcMain.handle("env:isHarnessE2E", () => process.env.HARNESS_E2E === "1");

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
  const e2eImportDir = process.env.HARNESS_E2E_IMPORT_DIR;
  if (e2eImportDir) {
    return importFromFolder(e2eImportDir);
  }
  const win = BrowserWindow.getAllWindows()[0] ?? null;
  const result = await dialog.showOpenDialog(win ?? undefined, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: 0, errors: [] as string[] };
  }
  return importFromFolder(result.filePaths[0]);
});

app.whenReady().then(() => {
  nativeTheme.themeSource = "dark";
  if (
    process.platform === "darwin" &&
    !isHarnessE2E() &&
    !systemPreferences.isTrustedAccessibilityClient(false)
  ) {
    systemPreferences.isTrustedAccessibilityClient(true);
  }
  registerSettingsHandlers();
  registerUsageStatsHandlers();
  registerMemoryHandlers();
  registerPlansHandlers();
  registerChatHandlers();
  registerCustomizationHandlers();
  registerFileToolsHandlers();
  registerAssistantToolsHandlers();
  registerNotesHandlers();
  registerRecordingHandlers();
  registerSystemHandlers();
  registerSyncHandlers();

  if (process.platform === "darwin") {
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }

  createWindow();

  const trayIconPath = join(app.getAppPath(), "resources", "icon-tray.png");
  const trayIcon = nativeImage.createFromPath(trayIconPath).resize({ width: 18, height: 18 });
  trayIcon.setTemplateImage(true);

  const trayRecordingIconPath = join(app.getAppPath(), "resources", "icon-tray-recording.png");
  const trayRecordingIcon = nativeImage.createFromPath(trayRecordingIconPath).resize({ width: 18, height: 18 });
  const trayProcessingIconPath = join(app.getAppPath(), "resources", "icon-tray-processing.png");
  const trayProcessingIcon = nativeImage.createFromPath(trayProcessingIconPath).resize({ width: 18, height: 18 });

  tray = new Tray(trayIcon);
  tray.setToolTip("Harness");
  tray.setTitle("");

  registerGlobalFnRecording({ tray, trayIcon, trayRecordingIcon, trayProcessingIcon });

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
