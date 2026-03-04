import { ipcMain } from "electron";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { Settings } from "../shared/types";

const SETTINGS_FILE = "settings.json";

function getSettingsPath(): string {
  return join(app.getPath("userData"), SETTINGS_FILE);
}

function loadSettings(): Settings {
  const path = getSettingsPath();
  if (!existsSync(path)) {
    return {
      version: 1,
      activeProvider: "openai",
      openai: { apiKey: "", model: "gpt-5.2" },
    };
  }
  const data = JSON.parse(readFileSync(path, "utf-8"));
  return {
    version: 1,
    activeProvider: data.activeProvider ?? "openai",
    openai: {
      apiKey: data.openai?.apiKey ?? "",
      model: data.openai?.model ?? "gpt-5.2",
    },
  };
}

function saveSettings(settings: Settings): void {
  const path = getSettingsPath();
  writeFileSync(path, JSON.stringify(settings, null, 2), "utf-8");
}

export function getSettings(): Settings {
  return loadSettings();
}

export function setSettings(partial: Partial<Settings>): Settings {
  const current = loadSettings();
  const next: Settings = {
    ...current,
    ...partial,
    openai: partial.openai ? { ...current.openai, ...partial.openai } : current.openai,
  };
  saveSettings(next);
  return next;
}

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", (_e, partial: Partial<Settings>) => setSettings(partial));
}
