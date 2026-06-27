import { ipcMain, BrowserWindow } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { LayoutOptions } from "../shared/types";
import { DEFAULT_LAYOUT } from "../shared/types";
import {
  applyThemeColors,
  DEFAULT_THEME_SETTINGS,
  findThemePreset,
  migrateThemeToPreset,
  normalizeThemeSettings,
  THEME_PRESETS,
  themeSettingsToCss,
  type ThemeSettings,
} from "../shared/theme";
import { ensureLocalDataMigration, getLocalDataThemesDir } from "./localDataPaths";

const THEME_FILE = "theme.json";
const LAYOUT_FILE = "layout.json";
const MAX_THEME_JSON = 32 * 1024;

function getThemesDir(): string {
  ensureLocalDataMigration();
  const dir = getLocalDataThemesDir();
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
    const normalized = normalizeThemeSettings(raw);
    const migrated = migrateThemeToPreset(normalized);
    const colorsChanged =
      migrated.accent !== normalized.accent ||
      migrated.fg !== normalized.fg ||
      migrated.bg !== normalized.bg;
    if (colorsChanged) {
      writeThemeFile({ ...migrated, updatedAt: Date.now() });
    }
    return migrated;
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
  const next = { ...normalizeThemeSettings(settings), updatedAt: Date.now() };
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
      gridOverlay:
        data.gridOverlay === "4" || data.gridOverlay === "8" || data.gridOverlay === "16"
          ? data.gridOverlay
          : "off",
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function setLayout(options: Partial<LayoutOptions>): void {
  const current = getLayoutOptions();
  const next: LayoutOptions = {
    sidebar: options.sidebar ?? current.sidebar,
    gridOverlay: options.gridOverlay ?? current.gridOverlay,
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

function getEffectiveThemeSettings(): ThemeSettings {
  return readThemeSettings() ?? DEFAULT_THEME_SETTINGS;
}

function themeToolPayload() {
  return {
    settings: getEffectiveThemeSettings(),
    presets: THEME_PRESETS.map((p) => ({ id: p.id, label: p.label, colors: p.colors })),
  };
}

function applyThemePatch(args: Record<string, unknown>): ThemeSettings {
  const current = getEffectiveThemeSettings();
  const merged: Record<string, unknown> = { ...current };
  if (typeof args.accent === "string") merged.accent = args.accent;
  if (args.font !== undefined) merged.font = args.font;
  if (args.fontMono !== undefined) merged.fontMono = args.fontMono;
  if (args.fontSize !== undefined) merged.fontSize = args.fontSize;
  if (typeof args.fg === "string") merged.fg = args.fg;
  if (typeof args.bg === "string") merged.bg = args.bg;
  const next = normalizeThemeSettings(merged);
  setThemeSettings(next);
  return next;
}

export const CUSTOMIZATION_TOOL_NAMES = [
  "get_theme",
  "update_theme",
  "apply_theme_preset",
  "set_layout",
] as const;

export type CustomizationToolName = (typeof CUSTOMIZATION_TOOL_NAMES)[number];

export function isCustomizationToolName(name: string): name is CustomizationToolName {
  return (CUSTOMIZATION_TOOL_NAMES as readonly string[]).includes(name);
}

export function executeCustomizationTool(name: string, args: Record<string, unknown>): string {
  try {
    if (name === "get_theme") {
      return JSON.stringify({ ok: true, ...themeToolPayload() });
    }
    if (name === "update_theme") {
      const settings = applyThemePatch(args);
      return JSON.stringify({ ok: true, settings });
    }
    if (name === "apply_theme_preset") {
      const presetId = typeof args.preset === "string" ? args.preset.trim() : "";
      const preset = findThemePreset(presetId);
      if (!preset) {
        return JSON.stringify({
          error: `Unknown preset: ${presetId || "(missing)"}`,
          presets: THEME_PRESETS.map((p) => p.id),
        });
      }
      const settings = applyThemeColors(getEffectiveThemeSettings(), preset.colors);
      setThemeSettings(settings);
      return JSON.stringify({ ok: true, preset: preset.id, settings });
    }
    if (name === "set_layout") {
      setLayout({
        sidebar: args.sidebar as LayoutOptions["sidebar"] | undefined,
        gridOverlay: args.gridOverlay as LayoutOptions["gridOverlay"] | undefined,
      });
      return JSON.stringify({ ok: true, layout: getLayoutOptions() });
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
