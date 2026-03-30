import { ipcMain } from "electron";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import { app } from "electron";
import { DEFAULT_SETTINGS } from "../shared/types";
import type { Settings } from "../shared/types";

const SETTINGS_FILE = "settings.json";

const D = DEFAULT_SETTINGS;

function getSettingsPath(): string {
  return join(app.getPath("userData"), SETTINGS_FILE);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function parseTranscription(raw: Record<string, unknown> | undefined): NonNullable<Settings["transcription"]> {
  const c = raw?.cleanup as Record<string, unknown> | undefined;
  return {
    cleanup: {
      enabled: typeof c?.enabled === "boolean" ? c.enabled : D.transcription!.cleanup!.enabled,
    },
  };
}

/** Accept legacy settings.json and normalize to the current schema. */
function parseSettings(data: Record<string, unknown>): Settings {
  const openaiRaw = data.openai as Record<string, unknown> | undefined;
  const apiKey =
    (typeof openaiRaw?.apiKey === "string" ? openaiRaw.apiKey : null) ?? D.openai!.apiKey;

  const searchRaw = data.search as Record<string, unknown> | undefined;
  const tavilyApiKey =
    (typeof searchRaw?.tavilyApiKey === "string" ? searchRaw.tavilyApiKey : null) ??
    D.search!.tavilyApiKey;

  return {
    version: D.version,
    openai: {
      apiKey,
    },
    search: {
      tavilyApiKey,
    },
    recording: {
      autoSend:
        typeof (data.recording as Record<string, unknown> | undefined)?.autoSend === "boolean"
          ? ((data.recording as Record<string, unknown>).autoSend as boolean)
          : D.recording!.autoSend,
    },
    transcription: parseTranscription(data.transcription as Record<string, unknown> | undefined),
  };
}

async function loadSettings(): Promise<Settings> {
  const path = getSettingsPath();
  if (!(await fileExists(path))) return { ...D };
  const raw = await readFile(path, "utf-8");
  return parseSettings(JSON.parse(raw));
}

async function saveSettings(settings: Settings): Promise<void> {
  await writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}

export async function getSettings(): Promise<Settings> {
  return loadSettings();
}

export async function setSettings(partial: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next: Settings = {
    ...current,
    ...partial,
    openai: partial.openai ? { ...current.openai, ...partial.openai } : current.openai,
    recording: partial.recording ? { ...current.recording, ...partial.recording } : current.recording,
    transcription: partial.transcription
      ? {
          ...current.transcription,
          ...partial.transcription,
          cleanup: partial.transcription.cleanup
            ? { ...current.transcription?.cleanup, ...partial.transcription.cleanup }
            : current.transcription?.cleanup,
        }
      : current.transcription,
  };
  await saveSettings(next);
  return next;
}

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", (_e, partial: Partial<Settings>) => setSettings(partial));
}
