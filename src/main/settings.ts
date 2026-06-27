import { ipcMain } from "electron";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { parseMemoryInjectionStrategy } from "../shared/memoryInjection";
import { stripSettingsSecrets } from "../shared/settingsSecrets";
import { DEFAULT_SETTINGS } from "../shared/types";
import type { Settings } from "../shared/types";
import { normalizeNoteTemplates } from "../shared/writing";
import {
  getCredential,
  migrateSecretsFromSettingsRaw,
  setCredential,
} from "./credentials";
import { fileExists } from "./utils";
import { ensureLocalDataMigration, getLocalDataSettingsPath } from "./localDataPaths";
import { applyGlobalFnHotkeySetting } from "./globalRecordingMain";

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

function parseSync(raw: Record<string, unknown> | undefined): NonNullable<Settings["sync"]> {
  const prefixRaw = typeof raw?.prefix === "string" ? raw.prefix.trim() : "";
  const prefix = prefixRaw || D.sync!.prefix;
  return {
    accountId: typeof raw?.accountId === "string" ? raw.accountId.trim() : D.sync!.accountId,
    bucket: typeof raw?.bucket === "string" ? raw.bucket.trim() : D.sync!.bucket,
    prefix: prefix.endsWith("/") ? prefix : `${prefix}/`,
    accessKeyId: typeof raw?.accessKeyId === "string" ? raw.accessKeyId.trim() : D.sync!.accessKeyId,
  };
}

/** Accept legacy settings.json and normalize to the current schema. Secrets are never loaded from disk. */
export function parseSettings(data: Record<string, unknown>): Settings {
  const weatherRaw = data.weather as Record<string, unknown> | undefined;
  const defaultZip =
    (typeof weatherRaw?.defaultZip === "string" ? weatherRaw.defaultZip : null) ??
    D.weather!.defaultZip;

  const memoryRaw = data.memory as Record<string, unknown> | undefined;
  const injectionStrategy = parseMemoryInjectionStrategy(memoryRaw?.injectionStrategy);

  const chatRaw = data.chat as Record<string, unknown> | undefined;
  const openToComposeOnLaunch =
    typeof chatRaw?.openToComposeOnLaunch === "boolean"
      ? chatRaw.openToComposeOnLaunch
      : typeof chatRaw?.composeFirst === "boolean"
        ? chatRaw.composeFirst
        : D.chat!.openToComposeOnLaunch;

  return {
    version: D.version,
    openai: { apiKey: "" },
    search: { tavilyApiKey: "" },
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
      globalFnHotkey:
        typeof (data.recording as Record<string, unknown> | undefined)?.globalFnHotkey === "boolean"
          ? ((data.recording as Record<string, unknown>).globalFnHotkey as boolean)
          : D.recording!.globalFnHotkey,
    },
    transcription: parseTranscription(data.transcription as Record<string, unknown> | undefined),
    sync: parseSync((data.sync as Record<string, unknown> | undefined) ?? undefined),
    memory: {
      injectionStrategy,
    },
    chat: {
      openToComposeOnLaunch,
    },
  };
}

async function migrateSettingsFileAtPath(path: string): Promise<void> {
  if (!(await fileExists(path))) return;
  const rawText = await readFile(path, "utf-8");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    return;
  }
  const migratedSecrets = await migrateSecretsFromSettingsRaw(raw);
  const stripped = stripSettingsSecrets(raw);
  if (!migratedSecrets && JSON.stringify(stripped) === JSON.stringify(raw)) return;
  await writeFile(path, JSON.stringify(stripped, null, 2), "utf-8");
}

export async function loadSettingsFromPath(path: string): Promise<Settings> {
  await migrateSettingsFileAtPath(path);
  if (!(await fileExists(path))) return { ...D };
  const raw = await readFile(path, "utf-8");
  return parseSettings(JSON.parse(raw));
}

async function loadSettings(): Promise<Settings> {
  return loadSettingsFromPath(getSettingsPath());
}

function stripSecretsBeforeSave(settings: Settings): Settings {
  return {
    ...settings,
    openai: { apiKey: "" },
    search: { tavilyApiKey: "" },
  };
}

export async function saveSettingsToPath(path: string, settings: Settings): Promise<void> {
  await writeFile(path, JSON.stringify(stripSecretsBeforeSave(settings), null, 2), "utf-8");
}

async function saveSettings(settings: Settings): Promise<void> {
  await saveSettingsToPath(getSettingsPath(), settings);
}

export async function getSettings(): Promise<Settings> {
  return loadSettings();
}

export async function setSettings(partial: Partial<Settings>): Promise<void> {
  if (partial.openai?.apiKey != null) {
    await setCredential("openai.apiKey", partial.openai.apiKey);
  }
  if (partial.search?.tavilyApiKey != null) {
    await setCredential("search.tavilyApiKey", partial.search.tavilyApiKey);
  }

  const current = await loadSettings();
  const prevGlobalFnHotkey = current.recording?.globalFnHotkey ?? D.recording!.globalFnHotkey;
  const next: Settings = {
    ...current,
    ...partial,
    openai: { apiKey: "" },
    search: { tavilyApiKey: "" },
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
    sync: partial.sync ? { ...current.sync, ...partial.sync } : current.sync,
    memory: partial.memory ? { ...current.memory, ...partial.memory } : current.memory,
    chat: partial.chat ? { ...current.chat, ...partial.chat } : current.chat,
  };
  await saveSettings(next);
  const nextGlobalFnHotkey = next.recording?.globalFnHotkey ?? D.recording!.globalFnHotkey;
  if (prevGlobalFnHotkey !== nextGlobalFnHotkey) {
    await applyGlobalFnHotkeySetting(nextGlobalFnHotkey);
  }
}

/** Main-process helper: OpenAI key from credential store. */
export async function resolveOpenAIApiKey(): Promise<string> {
  return (await getCredential("openai.apiKey")) ?? "";
}

/** Main-process helper: Tavily key from credential store. */
export async function resolveTavilyApiKey(): Promise<string> {
  return (await getCredential("search.tavilyApiKey")) ?? "";
}

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get", () => getSettings());
  ipcMain.handle("settings:set", (_e, partial: Partial<Settings>) => setSettings(partial));
}
