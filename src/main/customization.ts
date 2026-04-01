import { ipcMain, BrowserWindow } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { LayoutOptions } from "../shared/types";
import { DEFAULT_LAYOUT } from "../shared/types";
import {
  DEFAULT_THEME_SETTINGS,
  normalizeThemeSettings,
  themeSettingsToCss,
  type ThemeSettings,
} from "../shared/theme";

const THEMES_DIR = "themes";
const THEME_FILE = "theme.json";
const LAYOUT_FILE = "layout.json";
const MAX_THEME_JSON = 32 * 1024;

function getThemesDir(): string {
  const dir = join(app.getPath("userData"), THEMES_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getThemePath(): string {
  return join(getThemesDir(), THEME_FILE);
}

function getLayoutPath(): string {
  return join(app.getPath("userData"), LAYOUT_FILE);
}

function readThemeSettings(): ThemeSettings | null {
  const path = getThemePath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    return normalizeThemeSettings(raw);
  } catch {
    return null;
  }
}

function writeThemeFile(settings: ThemeSettings | null): void {
  const path = getThemePath();
  if (settings == null) {
    if (existsSync(path)) unlinkSync(path);
  } else {
    writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
  }
  notifyRenderer("customization:updated", { type: "theme" });
}

function getActiveThemeCss(): string {
  const s = readThemeSettings();
  return s ? themeSettingsToCss(s) : "";
}

function setThemeSettings(settings: ThemeSettings | null): void {
  if (settings == null) {
    writeThemeFile(null);
    return;
  }
  const next = normalizeThemeSettings(settings);
  const json = JSON.stringify(next);
  if (json.length > MAX_THEME_JSON) throw new Error("Theme data too large");
  writeThemeFile(next);
}

function getLayoutOptions(): LayoutOptions {
  const path = getLayoutPath();
  if (!existsSync(path)) return DEFAULT_LAYOUT;
  try {
    const data = JSON.parse(readFileSync(path, "utf-8"));
    return {
      sidebar: data.sidebar === "right" ? "right" : "left",
      density: data.density === "compact" ? "compact" : "comfortable",
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function setLayout(options: Partial<LayoutOptions>): void {
  const current = getLayoutOptions();
  const next: LayoutOptions = {
    sidebar: options.sidebar ?? current.sidebar,
    density: options.density ?? current.density,
  };
  writeFileSync(getLayoutPath(), JSON.stringify(next, null, 2), "utf-8");
  notifyRenderer("customization:updated", { type: "layout" });
}

function notifyRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

function applyThemePatch(args: Record<string, unknown>): void {
  const current = readThemeSettings() ?? DEFAULT_THEME_SETTINGS;
  const merged = {
    ...current,
    ...(typeof args.accent === "string" ? { accent: args.accent } : {}),
    ...(args.bodyFont !== undefined ? { bodyFont: args.bodyFont } : {}),
    ...(args.uiFont !== undefined ? { uiFont: args.uiFont } : {}),
    ...(args.headingFont !== undefined ? { headingFont: args.headingFont } : {}),
    ...(args.buttonFont !== undefined ? { buttonFont: args.buttonFont } : {}),
    ...(args.fontSize !== undefined ? { fontSize: args.fontSize } : {}),
  };
  setThemeSettings(normalizeThemeSettings(merged));
}

export function executeCustomizationTool(name: string, args: Record<string, unknown>): string {
  try {
    if (name === "update_theme") {
      applyThemePatch(args);
      return JSON.stringify({ ok: true, message: "Theme updated" });
    }
    if (name === "set_layout") {
      setLayout({
        sidebar: args.sidebar as LayoutOptions["sidebar"] | undefined,
        density: args.density as LayoutOptions["density"] | undefined,
      });
      return JSON.stringify({ ok: true, message: "Layout updated" });
    }
    return JSON.stringify({ error: `Unknown tool: ${name}` });
  } catch (err) {
    return JSON.stringify({ error: String(err) });
  }
}

export function registerCustomizationHandlers(): void {
  ipcMain.handle("customization:getActiveTheme", () => getActiveThemeCss());
  ipcMain.handle("customization:getThemeSettings", () => readThemeSettings() ?? DEFAULT_THEME_SETTINGS);
  ipcMain.handle("customization:setThemeSettings", (_e, settings: unknown) => {
    if (settings === null) {
      setThemeSettings(null);
      return;
    }
    setThemeSettings(normalizeThemeSettings(settings));
  });
  ipcMain.handle("customization:getLayoutOptions", () => getLayoutOptions());
  ipcMain.handle("customization:setLayout", (_e, options: Partial<LayoutOptions>) => setLayout(options));
}
