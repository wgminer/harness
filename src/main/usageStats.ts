import { app, ipcMain, shell } from "electron";
import { readFile, writeFile, access } from "fs/promises";
import { join } from "path";
import type { CompletionUsage } from "openai/resources/completions";
import { EMPTY_USAGE_STATS, type UsageStatsSnapshot } from "../shared/usageStats";

const USAGE_FILE = "usage-stats.json";

function getPath(): string {
  return join(app.getPath("userData"), USAGE_FILE);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function normalize(raw: Record<string, unknown> | null): UsageStatsSnapshot {
  if (!raw) return { ...EMPTY_USAGE_STATS, updatedAt: Date.now() };
  const o = raw.openai as Record<string, unknown> | undefined;
  const p = raw.parakeet as Record<string, unknown> | undefined;
  return {
    openai: {
      promptTokens: typeof o?.promptTokens === "number" && Number.isFinite(o.promptTokens) ? o.promptTokens : 0,
      completionTokens:
        typeof o?.completionTokens === "number" && Number.isFinite(o.completionTokens) ? o.completionTokens : 0,
      totalTokens: typeof o?.totalTokens === "number" && Number.isFinite(o.totalTokens) ? o.totalTokens : 0,
    },
    parakeet: {
      modelTokens: typeof p?.modelTokens === "number" && Number.isFinite(p.modelTokens) ? p.modelTokens : 0,
      words: typeof p?.words === "number" && Number.isFinite(p.words) ? p.words : 0,
      transcriptions:
        typeof p?.transcriptions === "number" && Number.isFinite(p.transcriptions) ? p.transcriptions : 0,
    },
    updatedAt: typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0,
  };
}

async function load(): Promise<UsageStatsSnapshot> {
  const path = getPath();
  if (!(await fileExists(path))) return { ...EMPTY_USAGE_STATS };
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    return normalize(raw);
  } catch {
    return { ...EMPTY_USAGE_STATS };
  }
}

async function save(snapshot: UsageStatsSnapshot): Promise<void> {
  await writeFile(getPath(), JSON.stringify(snapshot, null, 2), "utf-8");
}

/** Serialize writes so concurrent record* calls do not lose updates. */
let writeChain: Promise<void> = Promise.resolve();

function enqueue(fn: () => Promise<void>): void {
  writeChain = writeChain.then(fn).catch((err) => {
    console.error("[usageStats] persist failed:", err);
  });
}

export function recordOpenAIUsage(usage: CompletionUsage): void {
  const pt = usage.prompt_tokens ?? 0;
  const ct = usage.completion_tokens ?? 0;
  const tt = usage.total_tokens ?? pt + ct;
  enqueue(async () => {
    const s = await load();
    s.openai.promptTokens += pt;
    s.openai.completionTokens += ct;
    s.openai.totalTokens += tt;
    s.updatedAt = Date.now();
    await save(s);
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
    const s = await load();
    s.parakeet.transcriptions += 1;
    s.parakeet.words += words;
    if (modelTokens != null && Number.isFinite(modelTokens) && modelTokens > 0) {
      s.parakeet.modelTokens += Math.floor(modelTokens);
    }
    s.updatedAt = Date.now();
    await save(s);
  });
}

export async function getUsageStats(): Promise<UsageStatsSnapshot> {
  return load();
}

export function registerUsageStatsHandlers(): void {
  ipcMain.handle("usage:getStats", () => getUsageStats());
  ipcMain.handle("usage:reset", async () => {
    const cleared: UsageStatsSnapshot = { ...EMPTY_USAGE_STATS, updatedAt: Date.now() };
    await save(cleared);
    return cleared;
  });
  ipcMain.handle("usage:openOpenAIDashboard", async () => {
    await shell.openExternal("https://platform.openai.com/usage");
  });
}
