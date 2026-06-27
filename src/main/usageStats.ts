import { app, ipcMain } from "electron";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import {
  EMPTY_USAGE_STATS,
  type UsageStatsPersisted,
  type UsageStatsSnapshot,
} from "../shared/usageStats";
import { fileExists } from "./utils";

const USAGE_FILE = "usage-stats.json";

function getPath(): string {
  return join(app.getPath("userData"), USAGE_FILE);
}

function emptyPersisted(updatedAt = 0): UsageStatsPersisted {
  return {
    version: 3,
    parakeet: { ...EMPTY_USAGE_STATS.parakeet },
    updatedAt,
  };
}

function coerceParakeet(raw: Record<string, unknown> | undefined): UsageStatsPersisted["parakeet"] {
  const p = raw?.parakeet as Record<string, unknown> | undefined;
  return {
    modelTokens: typeof p?.modelTokens === "number" && Number.isFinite(p.modelTokens) ? p.modelTokens : 0,
    words: typeof p?.words === "number" && Number.isFinite(p.words) ? p.words : 0,
    transcriptions:
      typeof p?.transcriptions === "number" && Number.isFinite(p.transcriptions) ? p.transcriptions : 0,
  };
}

export function parseUsageStatsPersisted(raw: Record<string, unknown> | null): UsageStatsPersisted {
  if (!raw) return emptyPersisted();
  if (raw.version === 3) {
    return {
      version: 3,
      parakeet: coerceParakeet(raw),
      updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
    };
  }
  return {
    version: 3,
    parakeet: coerceParakeet(raw),
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

function persistedToSnapshot(persisted: UsageStatsPersisted): UsageStatsSnapshot {
  return {
    parakeet: { ...persisted.parakeet },
    updatedAt: persisted.updatedAt,
  };
}

async function loadPersisted(): Promise<UsageStatsPersisted> {
  const path = getPath();
  if (!(await fileExists(path))) return emptyPersisted();
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const parsed = parseUsageStatsPersisted(raw);
    if (raw.version !== 3) {
      await savePersisted(parsed);
    }
    return parsed;
  } catch {
    return emptyPersisted();
  }
}

async function savePersisted(persisted: UsageStatsPersisted): Promise<void> {
  await writeFile(getPath(), JSON.stringify(persisted, null, 2), "utf-8");
}

/** Serialize writes so concurrent record* calls do not lose updates. */
let writeChain: Promise<void> = Promise.resolve();

function enqueue(fn: () => Promise<void>): void {
  writeChain = writeChain.then(fn).catch((err) => {
    console.error("[usageStats] persist failed:", err);
  });
}

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** Call after a successful local transcription (Parakeet + optional cleanup). Skips tally when transcript is empty. */
export function recordParakeetTranscription(text: string, modelTokens: number | null | undefined): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  const words = countWords(trimmed);
  enqueue(async () => {
    const p = await loadPersisted();
    p.parakeet.transcriptions += 1;
    p.parakeet.words += words;
    if (modelTokens != null && Number.isFinite(modelTokens) && modelTokens > 0) {
      p.parakeet.modelTokens += Math.floor(modelTokens);
    }
    p.updatedAt = Date.now();
    await savePersisted(p);
  });
}

export async function getUsageStats(): Promise<UsageStatsSnapshot> {
  const p = await loadPersisted();
  return persistedToSnapshot(p);
}

export function registerUsageStatsHandlers(): void {
  ipcMain.handle("usage:getStats", () => getUsageStats());
  ipcMain.handle("usage:reset", async () => {
    const cleared = emptyPersisted(Date.now());
    await savePersisted(cleared);
    return persistedToSnapshot(cleared);
  });
}
