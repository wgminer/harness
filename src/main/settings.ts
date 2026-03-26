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
  try { await access(path); return true; } catch { return false; }
}

function defaultParakeetUseGpu(): boolean {
  return process.arch === "arm64" && process.platform === "darwin";
}

function parseTranscription(raw: Record<string, unknown> | undefined): NonNullable<Settings["transcription"]> {
  const activeProvider = (raw?.activeProvider as "openai" | "local") ?? D.transcription!.activeProvider;
  const p = raw?.parakeet as Record<string, unknown> | undefined;
  const useGpu =
    typeof p?.useGpu === "boolean" ? p.useGpu : defaultParakeetUseGpu();
  const fp16 = typeof p?.fp16 === "boolean" ? p.fp16 : (D.transcription!.parakeet!.fp16);
  return {
    activeProvider,
    parakeet: { useGpu, fp16 },
  };
}

function parseSettings(data: Record<string, unknown>): Settings {
  return {
    version: D.version,
    activeProvider: (data.activeProvider as Settings["activeProvider"]) ?? D.activeProvider,
    openai: {
      apiKey: (data.openai as Record<string, unknown> | undefined)?.apiKey as string ?? D.openai!.apiKey,
      model: (data.openai as Record<string, unknown> | undefined)?.model as string ?? D.openai!.model,
    },
    ollama: {
      baseUrl: (data.ollama as Record<string, unknown> | undefined)?.baseUrl as string ?? D.ollama!.baseUrl,
      model: (data.ollama as Record<string, unknown> | undefined)?.model as string ?? D.ollama!.model,
    },
    recording: {
      autoSend: (data.recording as Record<string, unknown> | undefined)?.autoSend as boolean ?? D.recording!.autoSend,
    },
    chat: {
      scrollOnStream:
        typeof (data.chat as Record<string, unknown> | undefined)?.scrollOnStream === "boolean"
          ? ((data.chat as Record<string, unknown>).scrollOnStream as boolean)
          : D.chat!.scrollOnStream,
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
    ollama: partial.ollama ? { ...current.ollama, ...partial.ollama } : current.ollama,
    recording: partial.recording ? { ...current.recording, ...partial.recording } : current.recording,
    chat: partial.chat ? { ...(current.chat ?? D.chat), ...partial.chat } : (current.chat ?? D.chat),
    transcription: partial.transcription
      ? {
          ...current.transcription,
          ...partial.transcription,
          parakeet: partial.transcription.parakeet
            ? { ...current.transcription?.parakeet, ...partial.transcription.parakeet }
            : current.transcription?.parakeet,
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
