import { ipcMain } from "electron";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { DEFAULT_SETTINGS } from "../shared/types";
import type { Settings } from "../shared/types";
import { normalizeNoteTemplates } from "../shared/writing";
import { fileExists } from "./utils";
import { ensureLocalDataMigration, getLocalDataSettingsPath } from "./localDataPaths";

const SETTINGS_FILE = "settings.json";

const D = DEFAULT_SETTINGS;

function getSettingsPath(): string {
  ensureLocalDataMigration();
  return getLocalDataSettingsPath();
}

export function getSettingsPathForUserData(userDataDir: string): string {
  return join(userDataDir, "local-data", "settings", SETTINGS_FILE);
}

function parseTranscription(raw: Record<string, unknown> | undefined): NonNullable<Settings["transcription"]> {
  const c = raw?.cleanup as Record<string, unknown> | undefined;
  const dictionaryRaw = Array.isArray(raw?.dictionary) ? raw.dictionary : [];
  const defaultPrompt = D.transcription!.cleanup!.prompt;
  const prompt = typeof c?.prompt === "string" && c.prompt.trim() ? c.prompt : defaultPrompt;
  const dedupe = new Set<string>();
  const dictionary = dictionaryRaw
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const from = typeof (entry as { from?: unknown }).from === "string" ? (entry as { from: string }).from.trim() : "";
      const to = typeof (entry as { to?: unknown }).to === "string" ? (entry as { to: string }).to.trim() : "";
      if (!from) return null;
      const key = from.toLowerCase();
      if (dedupe.has(key)) return null;
      dedupe.add(key);
      return { from, to };
    })
    .filter((entry): entry is { from: string; to: string } => entry != null);
  return {
    cleanup: {
      enabled: typeof c?.enabled === "boolean" ? c.enabled : D.transcription!.cleanup!.enabled,
      prompt,
    },
    dictionary,
  };
}

/** Accept legacy settings.json and normalize to the current schema. */
export function parseSettings(data: Record<string, unknown>): Settings {
  const openaiRaw = data.openai as Record<string, unknown> | undefined;
  const apiKey =
    (typeof openaiRaw?.apiKey === "string" ? openaiRaw.apiKey : null) ?? D.openai!.apiKey;

  const searchRaw = data.search as Record<string, unknown> | undefined;
  const tavilyApiKey =
    (typeof searchRaw?.tavilyApiKey === "string" ? searchRaw.tavilyApiKey : null) ??
    D.search!.tavilyApiKey;

  const weatherRaw = data.weather as Record<string, unknown> | undefined;
  const defaultZip =
    (typeof weatherRaw?.defaultZip === "string" ? weatherRaw.defaultZip : null) ??
    D.weather!.defaultZip;

  const backupRaw = data.backup as Record<string, unknown> | undefined;
  const folderPath =
    typeof backupRaw?.folderPath === "string" ? backupRaw.folderPath : D.backup!.folderPath;

  return {
    version: D.version,
    openai: {
      apiKey,
    },
    search: {
      tavilyApiKey,
    },
    weather: {
      defaultZip,
    },
    notes: {
      templates: normalizeNoteTemplates((data.notes as Record<string, unknown> | undefined)?.templates),
    },
    recording: {
      autoSend:
        typeof (data.recording as Record<string, unknown> | undefined)?.autoSend === "boolean"
          ? ((data.recording as Record<string, unknown>).autoSend as boolean)
          : D.recording!.autoSend,
    },
    transcription: parseTranscription(data.transcription as Record<string, unknown> | undefined),
    backup: {
      folderPath,
    },
  };
}

export async function loadSettingsFromPath(path: string): Promise<Settings> {
  if (!(await fileExists(path))) return { ...D };
  const raw = await readFile(path, "utf-8");
  return parseSettings(JSON.parse(raw));
}

async function loadSettings(): Promise<Settings> {
  return loadSettingsFromPath(getSettingsPath());
}

export async function saveSettingsToPath(path: string, settings: Settings): Promise<void> {
  await writeFile(path, JSON.stringify(settings, null, 2), "utf-8");
}

async function saveSettings(settings: Settings): Promise<void> {
  await saveSettingsToPath(getSettingsPath(), settings);
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
    search: partial.search ? { ...current.search, ...partial.search } : current.search,
    weather: partial.weather ? { ...current.weather, ...partial.weather } : current.weather,
    recording: partial.recording ? { ...current.recording, ...partial.recording } : current.recording,
    transcription: partial.transcription
      ? {
          ...current.transcription,
          ...partial.transcription,
          dictionary:
            partial.transcription.dictionary != null
              ? parseTranscription({ dictionary: partial.transcription.dictionary }).dictionary
              : current.transcription?.dictionary ?? D.transcription!.dictionary,
          cleanup: partial.transcription.cleanup
            ? { ...current.transcription?.cleanup, ...partial.transcription.cleanup }
            : current.transcription?.cleanup,
        }
      : current.transcription,
    notes: partial.notes
      ? {
          ...current.notes,
          ...partial.notes,
          templates:
            partial.notes.templates != null
              ? normalizeNoteTemplates(partial.notes.templates)
              : current.notes?.templates ?? D.notes!.templates,
        }
      : current.notes,
    backup: partial.backup ? { ...current.backup, ...partial.backup } : current.backup,
  };
  await saveSettings(next);
  return next;
}

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", (_e, partial: Partial<Settings>) => setSettings(partial));
}
