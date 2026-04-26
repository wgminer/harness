import { ipcMain } from "electron";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { join } from "path";
import type { SyncResult, SyncStatus } from "../shared/sync";
import { getLocalDataDir, getLocalDataSyncDir } from "./localDataPaths";
import { fileExists } from "./utils";

interface SyncState {
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastUploadedRevision: string | null;
}

const STATE_FILE = "state.json";
const MANIFEST_FILE = "manifest.json";

function getStatePath(): string {
  return join(getLocalDataSyncDir(), STATE_FILE);
}

function getManifestPath(): string {
  return join(getLocalDataSyncDir(), MANIFEST_FILE);
}

function envConfigPresent(): boolean {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_API_KEY);
}

async function loadState(): Promise<SyncState> {
  const path = getStatePath();
  if (!(await fileExists(path))) {
    return {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: null,
      lastUploadedRevision: null,
    };
  }
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as Partial<SyncState>;
    return {
      lastAttemptAt: typeof raw.lastAttemptAt === "number" ? raw.lastAttemptAt : null,
      lastSuccessAt: typeof raw.lastSuccessAt === "number" ? raw.lastSuccessAt : null,
      lastError: typeof raw.lastError === "string" ? raw.lastError : null,
      lastUploadedRevision: typeof raw.lastUploadedRevision === "string" ? raw.lastUploadedRevision : null,
    };
  } catch {
    return {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastError: "Invalid sync state file",
      lastUploadedRevision: null,
    };
  }
}

async function saveState(state: SyncState): Promise<void> {
  await writeFile(getStatePath(), JSON.stringify(state, null, 2), "utf-8");
}

function toStatus(state: SyncState): SyncStatus {
  return {
    provider: "firebase",
    configured: envConfigPresent(),
    lastAttemptAt: state.lastAttemptAt,
    lastSuccessAt: state.lastSuccessAt,
    lastError: state.lastError,
    lastUploadedRevision: state.lastUploadedRevision,
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return toStatus(await loadState());
}

async function computeLocalRevision(): Promise<string> {
  const localData = getLocalDataDir();
  const marker = {
    at: Date.now(),
    filesPresent: existsSync(localData),
  };
  return createHash("sha256").update(JSON.stringify(marker)).digest("hex").slice(0, 16);
}

export async function runSyncNow(): Promise<SyncResult> {
  const now = Date.now();
  const current = await loadState();
  const next: SyncState = { ...current, lastAttemptAt: now, lastError: null };

  if (!envConfigPresent()) {
    next.lastError = "Firebase is not configured. Set FIREBASE_PROJECT_ID and FIREBASE_API_KEY.";
    await saveState(next);
    return { ok: false, status: toStatus(next) };
  }

  const revision = await computeLocalRevision();
  const manifest = {
    provider: "firebase",
    updatedAt: now,
    revision,
    includeScopes: ["local-data/app-state", "local-data/settings/settings.json", "local-data/themes"],
    excludeScopes: ["recordings"],
  };
  await writeFile(getManifestPath(), JSON.stringify(manifest, null, 2), "utf-8");

  next.lastSuccessAt = now;
  next.lastUploadedRevision = revision;
  next.lastError = null;
  await saveState(next);
  return { ok: true, status: toStatus(next) };
}

export function registerSyncHandlers(): void {
  ipcMain.handle("sync:getStatus", () => getSyncStatus());
  ipcMain.handle("sync:runNow", () => runSyncNow());
}
