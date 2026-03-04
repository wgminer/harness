import { ipcMain, BrowserWindow } from "electron";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { LayoutOptions } from "../shared/types";
import { DEFAULT_LAYOUT } from "../shared/types";

const THEMES_DIR = "themes";
const CUSTOM_CSS = "custom.css";
const LAYOUT_FILE = "layout.json";
const MAX_CSS_SIZE = 100 * 1024; // 100KB

function getThemesDir(): string {
  const dir = join(app.getPath("userData"), THEMES_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function getCustomCssPath(): string {
  return join(getThemesDir(), CUSTOM_CSS);
}

function getLayoutPath(): string {
  return join(app.getPath("userData"), LAYOUT_FILE);
}

function validateCss(content: string): boolean {
  if (content.length > MAX_CSS_SIZE) return false;
  const lower = content.toLowerCase();
  if (lower.includes("<script") || lower.includes("javascript:")) return false;
  return true;
}

function getActiveTheme(): string {
  const path = getCustomCssPath();
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf-8");
}

function setTheme(cssContent: string): void {
  if (!validateCss(cssContent)) throw new Error("Invalid or too large CSS");
  const path = getCustomCssPath();
  writeFileSync(path, cssContent, "utf-8");
  notifyRenderer("customization:updated", { type: "theme" });
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

export function executeCustomizationTool(name: string, args: Record<string, unknown>): string {
  try {
    if (name === "update_theme") {
      const css = String(args.css_content ?? "");
      setTheme(css);
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
  ipcMain.handle("customization:getActiveTheme", () => getActiveTheme());
  ipcMain.handle("customization:setTheme", (_e, cssContent: string) => setTheme(cssContent));
  ipcMain.handle("customization:getLayoutOptions", () => getLayoutOptions());
  ipcMain.handle("customization:setLayout", (_e, options: Partial<LayoutOptions>) => setLayout(options));
}
