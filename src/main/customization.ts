import { ipcMain, BrowserWindow } from "electron";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { LayoutOptions } from "../shared/types";
import { DEFAULT_LAYOUT } from "../shared/types";

const LAYOUT_FILE = "layout.json";

function getLayoutPath(): string {
  return join(app.getPath("userData"), LAYOUT_FILE);
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

export const CUSTOMIZATION_TOOL_NAMES = ["set_layout"] as const;

export type CustomizationToolName = (typeof CUSTOMIZATION_TOOL_NAMES)[number];

export function isCustomizationToolName(name: string): name is CustomizationToolName {
  return (CUSTOMIZATION_TOOL_NAMES as readonly string[]).includes(name);
}

export function executeCustomizationTool(name: string, args: Record<string, unknown>): string {
  try {
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
  ipcMain.handle("customization:getLayoutOptions", () => getLayoutOptions());
  ipcMain.handle("customization:setLayout", (_e, options: Partial<LayoutOptions>) => setLayout(options));
}
