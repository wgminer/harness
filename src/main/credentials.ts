import { app, ipcMain, safeStorage } from "electron";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { fileExists } from "./utils";

export type CredentialKey = "openai.apiKey" | "search.tavilyApiKey" | "r2.secretAccessKey";

export interface CredentialStatus {
  hasOpenAIApiKey: boolean;
  hasTavilyApiKey: boolean;
  hasR2SecretAccessKey: boolean;
  encryptionAvailable: boolean;
}

export interface SettingsSecrets {
  openaiApiKey: string;
  tavilyApiKey: string;
  r2SecretAccessKey: string;
}

const STORE_FILENAME = "credentials.json";

interface CredentialStoreFile {
  version: 1;
  entries: Record<string, string>;
}

function getStorePath(): string {
  return join(app.getPath("userData"), STORE_FILENAME);
}

async function loadStoreFile(): Promise<CredentialStoreFile> {
  const path = getStorePath();
  if (!(await fileExists(path))) {
    return { version: 1, entries: {} };
  }
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as Partial<CredentialStoreFile>;
    if (raw.version === 1 && raw.entries && typeof raw.entries === "object") {
      return { version: 1, entries: { ...raw.entries } };
    }
  } catch {
    // Fall through to empty store.
  }
  return { version: 1, entries: {} };
}

async function saveStoreFile(store: CredentialStoreFile): Promise<void> {
  const path = getStorePath();
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(store, null, 2), "utf-8");
}

function encryptValue(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    return Buffer.from(value, "utf-8").toString("base64");
  }
  return safeStorage.encryptString(value).toString("base64");
}

function decryptValue(encoded: string): string | null {
  try {
    const bytes = Buffer.from(encoded, "base64");
    if (!safeStorage.isEncryptionAvailable()) {
      return bytes.toString("utf-8");
    }
    return safeStorage.decryptString(bytes);
  } catch {
    return null;
  }
}

export async function getCredential(key: CredentialKey): Promise<string | null> {
  const store = await loadStoreFile();
  const encoded = store.entries[key];
  if (!encoded) return null;
  const value = decryptValue(encoded);
  return value?.trim() ? value : null;
}

export async function setCredential(key: CredentialKey, value: string): Promise<void> {
  const trimmed = value.trim();
  const store = await loadStoreFile();
  if (!trimmed) {
    delete store.entries[key];
  } else {
    store.entries[key] = encryptValue(trimmed);
  }
  await saveStoreFile(store);
}

export async function deleteCredential(key: CredentialKey): Promise<void> {
  await setCredential(key, "");
}

export async function getCredentialStatus(): Promise<CredentialStatus> {
  const secrets = await getSecretsForSettings();
  return {
    hasOpenAIApiKey: Boolean(secrets.openaiApiKey),
    hasTavilyApiKey: Boolean(secrets.tavilyApiKey),
    hasR2SecretAccessKey: Boolean(secrets.r2SecretAccessKey),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  };
}

export async function getSecretsForSettings(): Promise<SettingsSecrets> {
  const [openai, tavily, r2] = await Promise.all([
    getCredential("openai.apiKey"),
    getCredential("search.tavilyApiKey"),
    getCredential("r2.secretAccessKey"),
  ]);
  return {
    openaiApiKey: openai ?? "",
    tavilyApiKey: tavily ?? "",
    r2SecretAccessKey: r2 ?? "",
  };
}

export async function migrateSecretsFromSettingsRaw(raw: Record<string, unknown>): Promise<boolean> {
  const openaiRaw = raw.openai as Record<string, unknown> | undefined;
  const searchRaw = raw.search as Record<string, unknown> | undefined;
  let changed = false;

  const openaiKey = typeof openaiRaw?.apiKey === "string" ? openaiRaw.apiKey.trim() : "";
  if (openaiKey) {
    const existing = await getCredential("openai.apiKey");
    if (!existing) {
      await setCredential("openai.apiKey", openaiKey);
    }
    delete openaiRaw!.apiKey;
    changed = true;
  }

  const tavilyKey =
    typeof searchRaw?.tavilyApiKey === "string" ? searchRaw.tavilyApiKey.trim() : "";
  if (tavilyKey) {
    const existing = await getCredential("search.tavilyApiKey");
    if (!existing) {
      await setCredential("search.tavilyApiKey", tavilyKey);
    }
    delete searchRaw!.tavilyApiKey;
    changed = true;
  }

  return changed;
}

export function registerCredentialHandlers(): void {
  ipcMain.handle("credentials:getStatus", () => getCredentialStatus());
  ipcMain.handle("credentials:getSecretsForSettings", () => getSecretsForSettings());
  ipcMain.handle("credentials:setOpenAIApiKey", (_e, value: string) =>
    setCredential("openai.apiKey", value),
  );
  ipcMain.handle("credentials:setTavilyApiKey", (_e, value: string) =>
    setCredential("search.tavilyApiKey", value),
  );
  ipcMain.handle("credentials:setR2SecretAccessKey", (_e, value: string) =>
    setCredential("r2.secretAccessKey", value),
  );
}

/** Convenience for main-process callers (chat, tools, sync). */
export async function getOpenAIApiKey(): Promise<string | null> {
  return getCredential("openai.apiKey");
}

export async function getTavilyApiKey(): Promise<string | null> {
  return getCredential("search.tavilyApiKey");
}

export async function getR2SecretAccessKey(): Promise<string | null> {
  return getCredential("r2.secretAccessKey");
}
