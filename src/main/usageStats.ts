import { app, ipcMain, shell } from "electron";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import type { CompletionUsage } from "openai/resources/completions";
import {
  estimateMonthCostUsd,
  utcMonthKey,
  utcMonthLabel,
  type ModelTokenUsage,
} from "../shared/openaiPricing";
import {
  EMPTY_USAGE_STATS,
  type OpenAIMonthModelUsage,
  type UsageStatsPersisted,
  type UsageStatsSnapshot,
} from "../shared/usageStats";
import { fileExists } from "./utils";

const USAGE_FILE = "usage-stats.json";
const LEGACY_UNKNOWN_MODEL = "unknown";

/** Injectable for tests. */
let nowProvider: () => Date = () => new Date();

export function setUsageStatsNowProvider(provider: () => Date): void {
  nowProvider = provider;
}

export function resetUsageStatsNowProvider(): void {
  nowProvider = () => new Date();
}

function getPath(): string {
  return join(app.getPath("userData"), USAGE_FILE);
}

function emptyModelUsage(): OpenAIMonthModelUsage {
  return { promptTokens: 0, cachedPromptTokens: 0, completionTokens: 0 };
}

function emptyPersisted(updatedAt = 0): UsageStatsPersisted {
  return {
    version: 2,
    openaiByMonth: {},
    parakeet: { ...EMPTY_USAGE_STATS.parakeet },
    updatedAt,
  };
}

function coerceModelUsage(raw: unknown): OpenAIMonthModelUsage {
  const r = raw as Record<string, unknown> | undefined;
  return {
    promptTokens:
      typeof r?.promptTokens === "number" && Number.isFinite(r.promptTokens) ? Math.max(0, r.promptTokens) : 0,
    cachedPromptTokens:
      typeof r?.cachedPromptTokens === "number" && Number.isFinite(r.cachedPromptTokens)
        ? Math.max(0, r.cachedPromptTokens)
        : 0,
    completionTokens:
      typeof r?.completionTokens === "number" && Number.isFinite(r.completionTokens)
        ? Math.max(0, r.completionTokens)
        : 0,
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

/** Fold legacy v1 flat openai totals into the current UTC month. */
export function migrateLegacyOpenAITotals(
  raw: Record<string, unknown>,
  monthKey: string
): UsageStatsPersisted {
  const base = emptyPersisted(
    typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
  );
  base.parakeet = coerceParakeet(raw);

  const existingByMonth = raw.openaiByMonth as Record<string, Record<string, unknown>> | undefined;
  if (existingByMonth && typeof existingByMonth === "object") {
    for (const [mk, models] of Object.entries(existingByMonth)) {
      if (!models || typeof models !== "object") continue;
      base.openaiByMonth[mk] = {};
      for (const [model, usage] of Object.entries(models)) {
        base.openaiByMonth[mk]![model] = coerceModelUsage(usage);
      }
    }
    return base;
  }

  const o = raw.openai as Record<string, unknown> | undefined;
  const promptTokens = typeof o?.promptTokens === "number" && Number.isFinite(o.promptTokens) ? o.promptTokens : 0;
  const completionTokens =
    typeof o?.completionTokens === "number" && Number.isFinite(o.completionTokens) ? o.completionTokens : 0;
  if (promptTokens > 0 || completionTokens > 0) {
    base.openaiByMonth[monthKey] = {
      [LEGACY_UNKNOWN_MODEL]: {
        promptTokens,
        cachedPromptTokens: 0,
        completionTokens,
      },
    };
  }
  return base;
}

export function parseUsageStatsPersisted(raw: Record<string, unknown> | null, at: Date): UsageStatsPersisted {
  if (!raw) return emptyPersisted();
  const monthKey = utcMonthKey(at);
  if (raw.version === 2 && raw.openaiByMonth && typeof raw.openaiByMonth === "object") {
    const p = emptyPersisted(
      typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
    );
    p.parakeet = coerceParakeet(raw);
    const byMonth = raw.openaiByMonth as Record<string, Record<string, unknown>>;
    for (const [mk, models] of Object.entries(byMonth)) {
      if (!models || typeof models !== "object") continue;
      p.openaiByMonth[mk] = {};
      for (const [model, usage] of Object.entries(models)) {
        p.openaiByMonth[mk]![model] = coerceModelUsage(usage);
      }
    }
    return p;
  }
  return migrateLegacyOpenAITotals(raw, monthKey);
}

function sumAllTimeOpenAI(byMonth: UsageStatsPersisted["openaiByMonth"]): UsageStatsSnapshot["openai"] {
  let promptTokens = 0;
  let completionTokens = 0;
  for (const models of Object.values(byMonth)) {
    for (const u of Object.values(models)) {
      promptTokens += u.promptTokens;
      completionTokens += u.completionTokens;
    }
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

function sumMonthUsage(byModel: Record<string, OpenAIMonthModelUsage> | undefined): ModelTokenUsage {
  let promptTokens = 0;
  let cachedPromptTokens = 0;
  let completionTokens = 0;
  if (!byModel) {
    return { promptTokens, cachedPromptTokens, completionTokens };
  }
  for (const u of Object.values(byModel)) {
    promptTokens += u.promptTokens;
    cachedPromptTokens += u.cachedPromptTokens;
    completionTokens += u.completionTokens;
  }
  return { promptTokens, cachedPromptTokens, completionTokens };
}

export function buildOpenAIThisMonthSnapshot(
  persisted: UsageStatsPersisted,
  at: Date
): UsageStatsSnapshot["openaiThisMonth"] {
  const monthKey = utcMonthKey(at);
  const byModel = persisted.openaiByMonth[monthKey];
  const totals = sumMonthUsage(byModel);
  return {
    monthKey,
    monthLabel: utcMonthLabel(monthKey),
    estimatedUsd: estimateMonthCostUsd(byModel ?? {}),
    ...totals,
  };
}

export function persistedToSnapshot(persisted: UsageStatsPersisted, at: Date): UsageStatsSnapshot {
  return {
    openai: sumAllTimeOpenAI(persisted.openaiByMonth),
    openaiThisMonth: buildOpenAIThisMonthSnapshot(persisted, at),
    parakeet: { ...persisted.parakeet },
    updatedAt: persisted.updatedAt,
  };
}

async function loadPersisted(): Promise<UsageStatsPersisted> {
  const path = getPath();
  if (!(await fileExists(path))) return emptyPersisted();
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as Record<string, unknown>;
    const at = nowProvider();
    const parsed = parseUsageStatsPersisted(raw, at);
    if (raw.version !== 2) {
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

export function extractCachedPromptTokens(usage: CompletionUsage): number {
  const details = (usage as { prompt_tokens_details?: { cached_tokens?: number } }).prompt_tokens_details;
  const cached = details?.cached_tokens;
  if (typeof cached !== "number" || !Number.isFinite(cached)) return 0;
  return Math.max(0, Math.floor(cached));
}

export function recordOpenAIUsage(usage: CompletionUsage, model: string): void {
  const pt = usage.prompt_tokens ?? 0;
  const ct = usage.completion_tokens ?? 0;
  const cached = extractCachedPromptTokens(usage);
  const modelId = model.trim() || LEGACY_UNKNOWN_MODEL;
  enqueue(async () => {
    const at = nowProvider();
    const monthKey = utcMonthKey(at);
    const p = await loadPersisted();
    if (!p.openaiByMonth[monthKey]) p.openaiByMonth[monthKey] = {};
    const bucket = p.openaiByMonth[monthKey]!;
    if (!bucket[modelId]) bucket[modelId] = emptyModelUsage();
    bucket[modelId].promptTokens += pt;
    bucket[modelId].cachedPromptTokens += cached;
    bucket[modelId].completionTokens += ct;
    p.updatedAt = Date.now();
    await savePersisted(p);
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
  return persistedToSnapshot(p, nowProvider());
}

export function registerUsageStatsHandlers(): void {
  ipcMain.handle("usage:getStats", () => getUsageStats());
  ipcMain.handle("usage:reset", async () => {
    const cleared = emptyPersisted(Date.now());
    await savePersisted(cleared);
    return persistedToSnapshot(cleared, nowProvider());
  });
  ipcMain.handle("usage:openOpenAIDashboard", async () => {
    await shell.openExternal("https://platform.openai.com/usage");
  });
}
