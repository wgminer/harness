import { DEFAULT_ACCENT, normalizeAccentHex } from "../../shared/accent";
import { DEFAULT_SETTINGS, type Settings, type TranscriptDictionaryEntry } from "../../shared/types";
import {
  DEFAULT_NOTE_TEMPLATE_ID,
  normalizeDefaultNoteTemplateId,
  normalizeNoteTemplates,
  type NoteTemplateConfig,
} from "../../shared/writing";
import type { SettingsTabId } from "./settingsNavConfig";

export type CachedSettingsSecrets = {
  openaiApiKey: string;
  tavilyApiKey: string;
  r2SecretAccessKey: string;
};

export type NonSecretSettingsHydration = {
  autoSend: boolean;
  globalFnHotkey: boolean;
  bringToFrontOnBackgroundDictation: boolean;
  openToComposeOnLaunch: boolean;
  selectionImageLookup: boolean;
  cleanupEnabled: boolean;
  cleanupPrompt: string;
  transcriptDictionary: TranscriptDictionaryEntry[];
  r2AccountId: string;
  r2Bucket: string;
  r2Prefix: string;
  r2AccessKeyId: string;
  accent: string;
  noteTemplates: NoteTemplateConfig[];
  defaultNoteTemplateId: string;
  weatherZip: string;
};

const D = DEFAULT_SETTINGS;

let cachedSettings: Settings | null = null;
let cachedSecrets: CachedSettingsSecrets | null = null;
let cachedAccessibilityTrusted: boolean | null = null;
let cachedHasOpenAIApiKey: boolean | null = null;

export function getCachedSettings(): Settings | null {
  return cachedSettings;
}

export function setCachedSettings(settings: Settings): void {
  cachedSettings = settings;
}

export function getCachedSecrets(): CachedSettingsSecrets | null {
  return cachedSecrets;
}

export function setCachedSecrets(secrets: CachedSettingsSecrets): void {
  cachedSecrets = secrets;
}

export function getCachedAccessibilityTrusted(): boolean | null {
  return cachedAccessibilityTrusted;
}

export function setCachedAccessibilityTrusted(value: boolean | null): void {
  cachedAccessibilityTrusted = value;
}

export function getCachedHasOpenAIApiKey(): boolean | null {
  return cachedHasOpenAIApiKey;
}

export function setCachedHasOpenAIApiKey(value: boolean): void {
  cachedHasOpenAIApiKey = value;
}

export function resetSettingsSessionCacheForTests(): void {
  cachedSettings = null;
  cachedSecrets = null;
  cachedAccessibilityTrusted = null;
  cachedHasOpenAIApiKey = null;
}

/** Secrets are only needed for Data fields or Sync QR pairing. */
export function shouldLoadSettingsSecrets(
  activeTab: SettingsTabId,
  syncQrOpen: boolean,
  alreadyLoaded: boolean,
): boolean {
  if (alreadyLoaded) return false;
  return activeTab === "data" || syncQrOpen;
}

/**
 * Prefer the warm session cache so System → General paints without waiting on IPC.
 * Cold open fetches once and seeds the cache.
 */
export async function loadSettingsForSystemPage(deps: {
  getCached: () => Settings | null;
  fetchSettings: () => Promise<Settings>;
  setCache: (settings: Settings) => void;
}): Promise<{ settings: Settings; fetched: boolean }> {
  const cached = deps.getCached();
  if (cached) {
    return { settings: cached, fetched: false };
  }
  const settings = await deps.fetchSettings();
  deps.setCache(settings);
  return { settings, fetched: true };
}

export function nonSecretHydrationFromSettings(S: Settings): NonSecretSettingsHydration {
  const templates = normalizeNoteTemplates(S.notes?.templates);
  return {
    autoSend: S.recording?.autoSend ?? D.recording!.autoSend,
    globalFnHotkey: S.recording?.globalFnHotkey ?? D.recording!.globalFnHotkey,
    bringToFrontOnBackgroundDictation:
      S.recording?.bringToFrontOnBackgroundDictation ??
      D.recording!.bringToFrontOnBackgroundDictation,
    openToComposeOnLaunch:
      S.chat?.openToComposeOnLaunch ??
      (S.chat as { composeFirst?: boolean } | undefined)?.composeFirst ??
      D.chat!.openToComposeOnLaunch,
    selectionImageLookup:
      S.chat?.selectionImageLookup ?? D.chat!.selectionImageLookup,
    cleanupEnabled: S.transcription?.cleanup?.enabled ?? D.transcription?.cleanup?.enabled ?? false,
    cleanupPrompt: S.transcription?.cleanup?.prompt ?? D.transcription?.cleanup?.prompt ?? "",
    transcriptDictionary: S.transcription?.dictionary ?? D.transcription?.dictionary ?? [],
    r2AccountId: S.sync?.accountId ?? D.sync!.accountId,
    r2Bucket: S.sync?.bucket ?? D.sync!.bucket,
    r2Prefix: S.sync?.prefix ?? D.sync!.prefix,
    r2AccessKeyId: S.sync?.accessKeyId ?? D.sync!.accessKeyId,
    accent: normalizeAccentHex(S.appearance?.accent ?? D.appearance?.accent ?? DEFAULT_ACCENT),
    noteTemplates: templates,
    defaultNoteTemplateId: normalizeDefaultNoteTemplateId(S.notes?.defaultTemplateId, templates),
    weatherZip: S.weather?.defaultZip ?? D.weather!.defaultZip,
  };
}
