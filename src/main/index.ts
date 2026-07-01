import "./e2eBootstrap";
import "./devBootstrap";
import { app, BrowserWindow, ipcMain, Menu, nativeImage, dialog, nativeTheme, globalShortcut, systemPreferences } from "electron";
import { isHarnessDev, isHarnessE2E } from "./e2eStub";
import { HARNESS_DEV_APP_NAME } from "./devBootstrap";
import { join } from "path";
import { registerCredentialHandlers } from "./credentials";
import { registerSettingsHandlers, getSettings } from "./settings";
import { registerUsageStatsHandlers } from "./usageStats";
import { pruneEmptyConversations, registerMemoryHandlers } from "./memory";
import { registerChatHandlers } from "./chat";
import { registerCustomizationHandlers } from "./customization";
import { registerFileToolsHandlers } from "./fileTools";
import { registerAssistantToolsHandlers } from "./assistantTools";
import { registerPlansHandlers } from "./plans";
import { registerNotesHandlers } from "./writing";
import { registerRecordingHandlers } from "./recording";
import { registerGlobalFnRecording, applyGlobalFnHotkeySetting } from "./globalRecordingMain";
import { registerSystemHandlers } from "./systemHandlers";
import { importFromFolder as importFromChatGPTFolder } from "./importChatGPT";
import { importFromFolder as importFromClaudeFolder } from "./importClaude";
import { registerMemoryCompileHandlers } from "./memoryCompile";
import { registerMemoryImportHandlers } from "./memoryImport";
import { registerSyncHandlers } from "./sync";
import { registerUiSessionHandlers } from "./uiSession";
import { registerUpdaterHandlers, startUpdateCheck } from "./updater";
import {
  WINDOW_SMALL_PRESET_MAX_WIDTH_PX,
} from "../shared/windowLayout";
import { DEFAULT_SETTINGS } from "../shared/types";

let mainWindow: BrowserWindow | null = null;

const isDevBuild = isHarnessDev() && !isHarnessE2E();
const appDisplayName = isDevBuild ? HARNESS_DEV_APP_NAME : "Harness";

function appResourcePath(fileName: string): string {
  return join(app.getAppPath(), "resources", fileName);
}

const iconPath = appResourcePath(isDevBuild ? "icon-dev.png" : "icon.png");

const LARGE_WIDTH = 1024;
const LARGE_HEIGHT = 768;
const SMALL_WIDTH = 400;
const SMALL_HEIGHT = 480;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: LARGE_WIDTH,
    height: LARGE_HEIGHT,
    title: appDisplayName,
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

ipcMain.handle("env:isHarnessDev", () => isDevBuild);

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
    return importFromChatGPTFolder(e2eImportDir);
  }
  const win = BrowserWindow.getAllWindows()[0] ?? null;
  const result = await dialog.showOpenDialog(win ?? undefined, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: 0, errors: [] as string[] };
  }
  return importFromChatGPTFolder(result.filePaths[0]);
});

ipcMain.handle("memory:importFromClaudeFolder", async () => {
  const e2eImportDir = process.env.HARNESS_E2E_CLAUDE_IMPORT_DIR;
  if (e2eImportDir) {
    return importFromClaudeFolder(e2eImportDir);
  }
  const win = BrowserWindow.getAllWindows()[0] ?? null;
  const result = await dialog.showOpenDialog(win ?? undefined, { properties: ["openDirectory"] });
  if (result.canceled || result.filePaths.length === 0) {
    return { imported: 0, errors: [] as string[] };
  }
  return importFromClaudeFolder(result.filePaths[0]);
});

app.whenReady().then(async () => {
  nativeTheme.themeSource = "dark";
  registerCredentialHandlers();
  registerSettingsHandlers();
  const settings = await getSettings();
  const globalFnHotkeyEnabled = settings.recording?.globalFnHotkey ?? DEFAULT_SETTINGS.recording!.globalFnHotkey;
  if (
    process.platform === "darwin" &&
    !isHarnessE2E() &&
    globalFnHotkeyEnabled &&
    !systemPreferences.isTrustedAccessibilityClient(false)
  ) {
    systemPreferences.isTrustedAccessibilityClient(true);
  }
  registerUsageStatsHandlers();
  registerMemoryHandlers();
  await pruneEmptyConversations();
  registerMemoryCompileHandlers();
  registerMemoryImportHandlers();
  registerPlansHandlers();
  registerChatHandlers();
  registerCustomizationHandlers();
  registerFileToolsHandlers();
  registerAssistantToolsHandlers();
  const { migrateClippingsToNote } = await import("./migrateClippingsToNote");
  await migrateClippingsToNote();
  registerNotesHandlers();
  registerRecordingHandlers();
  registerSystemHandlers();
  registerSyncHandlers();
  registerUiSessionHandlers();
  registerUpdaterHandlers();

  if (process.platform === "darwin") {
    app.dock.setIcon(nativeImage.createFromPath(iconPath));
  }

  createWindow();

  startUpdateCheck();

  registerGlobalFnRecording({ appDisplayName, isDevBuild });
  await applyGlobalFnHotkeySetting(globalFnHotkeyEnabled);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Memory compile is manual-only for now (triggered from System → Context).
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
