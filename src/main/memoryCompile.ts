import { ipcMain } from "electron";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import OpenAI from "openai";
import {
  getMemoryDir,
  getUserMemoryIn,
  loadConversationsIn,
  loadMessagesIn,
  setUserMemoryIn,
} from "./memory";
import { fileExists } from "./utils";
import { getSettings } from "./settings";
import { OPENAI_TRANSCRIPT_CLEANUP_MODEL } from "../shared/openaiModels";
import { recordOpenAIUsage } from "./usageStats";

const STATE_FILE = "memory_compile_state.json";

/** Default look-back window for the very first run when we have no prior `lastRunAt`. */
const FIRST_RUN_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Cap how many user-message characters we feed the model per run (keeps cost predictable). */
export const MEMORY_COMPILE_CHAR_BUDGET = 24_000;

/** Cap distinct conversations included in a single compile, oldest-first within the window. */
export const MEMORY_COMPILE_MAX_CONVERSATIONS = 30;

export interface MemoryCompileState {
  /** Wall-clock ms of the last successful compile run. */
  lastRunAt: number | null;
  /** Local YYYY-MM-DD of the last successful run, used for "already ran today" gating. */
  lastRunDateLocal: string | null;
  /** Number of new memory entries written by the last run. */
  lastAddedCount: number;
  /** Number of existing entries updated by the last run. */
  lastUpdatedCount: number;
  /** Conversations considered by the last run. */
  lastConsideredCount: number;
  /** Last error message, when the last run failed. */
  lastError: string | null;
}

export const EMPTY_COMPILE_STATE: MemoryCompileState = {
  lastRunAt: null,
  lastRunDateLocal: null,
  lastAddedCount: 0,
  lastUpdatedCount: 0,
  lastConsideredCount: 0,
  lastError: null,
};

function getStatePath(memoryDir: string): string {
  return join(memoryDir, STATE_FILE);
}

export async function loadCompileStateIn(memoryDir: string): Promise<MemoryCompileState> {
  const path = getStatePath(memoryDir);
  if (!(await fileExists(path))) return { ...EMPTY_COMPILE_STATE };
  try {
    const raw = JSON.parse(await readFile(path, "utf-8")) as Partial<MemoryCompileState>;
    return {
      lastRunAt: typeof raw.lastRunAt === "number" ? raw.lastRunAt : null,
      lastRunDateLocal: typeof raw.lastRunDateLocal === "string" ? raw.lastRunDateLocal : null,
      lastAddedCount: typeof raw.lastAddedCount === "number" ? raw.lastAddedCount : 0,
      lastUpdatedCount: typeof raw.lastUpdatedCount === "number" ? raw.lastUpdatedCount : 0,
      lastConsideredCount: typeof raw.lastConsideredCount === "number" ? raw.lastConsideredCount : 0,
      lastError: typeof raw.lastError === "string" ? raw.lastError : null,
    };
  } catch {
    return { ...EMPTY_COMPILE_STATE };
  }
}

export async function saveCompileStateIn(memoryDir: string, state: MemoryCompileState): Promise<void> {
  await writeFile(getStatePath(memoryDir), JSON.stringify(state, null, 2), "utf-8");
}

/** Local-date string in `YYYY-MM-DD` form (used to gate "once per day"). */
export function localDateString(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True when no successful compile has happened yet today (local time). */
export function isCompileDue(state: MemoryCompileState, now: Date): boolean {
  if (state.lastRunDateLocal == null) return true;
  return state.lastRunDateLocal !== localDateString(now);
}

/** Distilled fact from the LLM — `key` is a stable snake_case label, `value` is one-line detail. */
export interface DistilledFact {
  key: string;
  value: string;
}

/** Provider abstraction used by the compiler — kept narrow so tests can inject a fake. */
export interface MemoryCompileLLM {
  distill(transcripts: string): Promise<DistilledFact[]>;
}

interface ConversationSlice {
  id: string;
  createdAt: number;
  title: string | null;
  newestMessageAt: number;
  userText: string;
}

function pickWindowStart(state: MemoryCompileState, now: number): number {
  if (state.lastRunAt != null && state.lastRunAt > 0) return state.lastRunAt;
  return now - FIRST_RUN_LOOKBACK_MS;
}

async function collectSlicesSince(memoryDir: string, since: number): Promise<ConversationSlice[]> {
  const conv = await loadConversationsIn(memoryDir);
  const out: ConversationSlice[] = [];
  for (const [id, meta] of Object.entries(conv)) {
    const messages = await loadMessagesIn(memoryDir, id);
    if (messages.length === 0) continue;
    // When messages carry timestamps we trust those exclusively — `meta.createdAt`
    // is set on conversation creation (which happens at import / new-thread time)
    // and would otherwise mark every recently-imported thread as "fresh activity"
    // even when its messages are weeks old.
    let newestMessageTimestamp = -Infinity;
    let hasAnyTimestamp = false;
    const userParts: string[] = [];
    for (const m of messages) {
      if (typeof m.timestamp === "number") {
        hasAnyTimestamp = true;
        if (m.timestamp > newestMessageTimestamp) newestMessageTimestamp = m.timestamp;
      }
      if (m.role === "user" && m.content.trim()) userParts.push(m.content.trim());
    }
    const newestAt = hasAnyTimestamp ? newestMessageTimestamp : meta.createdAt;
    if (newestAt < since) continue;
    if (userParts.length === 0) continue;
    out.push({
      id,
      createdAt: meta.createdAt,
      title: meta.title,
      newestMessageAt: newestAt,
      userText: userParts.join("\n\n"),
    });
  }
  // Most recent first so the model sees fresh material when budgets bite.
  out.sort((a, b) => b.newestMessageAt - a.newestMessageAt);
  return out;
}

/**
 * Build a single transcript string from conversation slices, oldest-first within
 * the per-run budget so we surface the most recent activity first to the model.
 * Returns the transcript and the slices we actually included.
 */
export function buildTranscript(slices: ConversationSlice[]): { transcript: string; included: ConversationSlice[] } {
  const included: ConversationSlice[] = [];
  const blocks: string[] = [];
  let used = 0;
  for (const s of slices) {
    if (included.length >= MEMORY_COMPILE_MAX_CONVERSATIONS) break;
    const header = `--- Conversation ${included.length + 1}${s.title ? `: ${s.title}` : ""} ---`;
    const body = s.userText;
    const cost = header.length + body.length + 2;
    if (used + cost > MEMORY_COMPILE_CHAR_BUDGET && included.length > 0) break;
    blocks.push(`${header}\n${body}`);
    included.push(s);
    used += cost;
  }
  return { transcript: blocks.join("\n\n"), included };
}

/**
 * Merge distilled facts into existing user-memory. Returns counts of what
 * actually changed so we can surface the result to the user.
 *
 * Rules:
 * - Lookups are case-insensitive on the key, but we preserve the existing key
 *   spelling on update so a stable label keeps its capitalization across runs.
 * - We skip empty values and trim whitespace defensively (the LLM occasionally
 *   returns trailing newlines).
 * - We update an existing entry only when the new value is materially different
 *   from the stored one (case-sensitive equality after trimming).
 */
export function mergeFacts(
  existing: Record<string, string>,
  facts: DistilledFact[]
): { merged: Record<string, string>; added: number; updated: number } {
  const merged = { ...existing };
  const lowerToKey = new Map<string, string>();
  for (const k of Object.keys(merged)) lowerToKey.set(k.toLowerCase(), k);

  let added = 0;
  let updated = 0;
  const seenLowerKeys = new Set<string>();

  for (const fact of facts) {
    const rawKey = typeof fact.key === "string" ? fact.key.trim() : "";
    const rawValue = typeof fact.value === "string" ? fact.value.trim() : "";
    if (!rawKey || !rawValue) continue;
    const lower = rawKey.toLowerCase();
    if (seenLowerKeys.has(lower)) continue;
    seenLowerKeys.add(lower);

    const existingKey = lowerToKey.get(lower);
    if (existingKey == null) {
      merged[rawKey] = rawValue;
      lowerToKey.set(lower, rawKey);
      added += 1;
      continue;
    }
    if (merged[existingKey].trim() !== rawValue) {
      merged[existingKey] = rawValue;
      updated += 1;
    }
  }

  return { merged, added, updated };
}

const SYSTEM_PROMPT = [
  "You are a memory distiller for a personal LLM workspace.",
  "From the user-message transcripts below, extract durable, stable facts the user expressed about themselves.",
  "Include only things that will remain true for weeks or months: location/timezone, ongoing projects, tools and stack they use, preferences, recurring people they work with, professional role, equipment.",
  "DO NOT include: single-task asks, ephemeral state (today's mood, transient errors), assistant suggestions the user did not commit to, or sensitive personal information beyond what the user clearly stated.",
  "Output strict JSON with this exact shape and nothing else:",
  '{ "facts": [ { "key": "snake_case_label", "value": "one-line detail" } ] }',
  "Keys must be short lowercase snake_case (max 40 chars). Values must fit on one line (max 200 chars).",
  "If nothing durable surfaces, output { \"facts\": [] }.",
].join("\n");

export function parseFactsResponse(raw: string): DistilledFact[] {
  if (!raw) return [];
  // Some models wrap JSON in ``` fences despite instructions; strip them.
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    const parsed = JSON.parse(trimmed) as { facts?: unknown };
    const facts = Array.isArray(parsed.facts) ? parsed.facts : [];
    const out: DistilledFact[] = [];
    for (const f of facts) {
      if (!f || typeof f !== "object") continue;
      const key = (f as { key?: unknown }).key;
      const value = (f as { value?: unknown }).value;
      if (typeof key !== "string" || typeof value !== "string") continue;
      out.push({ key, value });
    }
    return out;
  } catch {
    return [];
  }
}

/** Real OpenAI-backed distiller. Tests inject a fake instead. */
export function createOpenAIDistiller(apiKey: string): MemoryCompileLLM {
  const client = new OpenAI({ apiKey });
  return {
    async distill(transcripts: string): Promise<DistilledFact[]> {
      const completion = await client.chat.completions.create(
        {
          model: OPENAI_TRANSCRIPT_CLEANUP_MODEL,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: transcripts },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 1500,
        },
        { signal: AbortSignal.timeout(60_000) }
      );
      if (completion.usage) recordOpenAIUsage(completion.usage, OPENAI_TRANSCRIPT_CLEANUP_MODEL);
      const raw = completion.choices[0]?.message?.content?.trim() ?? "";
      return parseFactsResponse(raw);
    },
  };
}

export interface CompileResult {
  ranAt: number;
  considered: number;
  added: number;
  updated: number;
  skipped: boolean;
  /** Reason we skipped without calling the LLM, when applicable. */
  skipReason?: "no-conversations" | "empty-transcript";
}

/**
 * Pure-ish core: picks conversations updated since the last run, asks the
 * distiller to extract durable facts, merges them into user memory, and
 * persists state. `now` is injected for deterministic tests.
 */
export async function compileMemoriesIn(
  memoryDir: string,
  llm: MemoryCompileLLM,
  now: Date
): Promise<CompileResult> {
  const state = await loadCompileStateIn(memoryDir);
  const since = pickWindowStart(state, now.getTime());
  const slices = await collectSlicesSince(memoryDir, since);
  if (slices.length === 0) {
    const next: MemoryCompileState = {
      ...state,
      lastRunAt: now.getTime(),
      lastRunDateLocal: localDateString(now),
      lastAddedCount: 0,
      lastUpdatedCount: 0,
      lastConsideredCount: 0,
      lastError: null,
    };
    await saveCompileStateIn(memoryDir, next);
    return { ranAt: now.getTime(), considered: 0, added: 0, updated: 0, skipped: true, skipReason: "no-conversations" };
  }
  const { transcript, included } = buildTranscript(slices);
  if (!transcript) {
    const next: MemoryCompileState = {
      ...state,
      lastRunAt: now.getTime(),
      lastRunDateLocal: localDateString(now),
      lastAddedCount: 0,
      lastUpdatedCount: 0,
      lastConsideredCount: 0,
      lastError: null,
    };
    await saveCompileStateIn(memoryDir, next);
    return { ranAt: now.getTime(), considered: 0, added: 0, updated: 0, skipped: true, skipReason: "empty-transcript" };
  }
  const facts = await llm.distill(transcript);
  const existing = await getUserMemoryIn(memoryDir);
  const { merged, added, updated } = mergeFacts(existing, facts);
  for (const [key, value] of Object.entries(merged)) {
    if (existing[key] !== value) {
      await setUserMemoryIn(memoryDir, key, value);
    }
  }
  const next: MemoryCompileState = {
    lastRunAt: now.getTime(),
    lastRunDateLocal: localDateString(now),
    lastAddedCount: added,
    lastUpdatedCount: updated,
    lastConsideredCount: included.length,
    lastError: null,
  };
  await saveCompileStateIn(memoryDir, next);
  return { ranAt: now.getTime(), considered: included.length, added, updated, skipped: false };
}

async function recordCompileError(memoryDir: string, message: string): Promise<void> {
  const state = await loadCompileStateIn(memoryDir);
  await saveCompileStateIn(memoryDir, { ...state, lastError: message });
}

async function buildLLMFromSettings(): Promise<MemoryCompileLLM | null> {
  const settings = await getSettings();
  const apiKey = settings.openai?.apiKey?.trim() ?? "";
  if (!apiKey) return null;
  return createOpenAIDistiller(apiKey);
}

/**
 * Run the compile if it hasn't already run today (local time). No-ops silently
 * if no API key is configured — startup never blocks on this.
 */
export async function runMemoryCompileIfDue(now: Date = new Date()): Promise<CompileResult | { skipped: true; reason: "not-due" | "no-api-key" }> {
  const memoryDir = getMemoryDir();
  const state = await loadCompileStateIn(memoryDir);
  if (!isCompileDue(state, now)) return { skipped: true, reason: "not-due" };
  const llm = await buildLLMFromSettings();
  if (llm == null) return { skipped: true, reason: "no-api-key" };
  try {
    return await compileMemoriesIn(memoryDir, llm, now);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordCompileError(memoryDir, message);
    return { ranAt: now.getTime(), considered: 0, added: 0, updated: 0, skipped: true };
  }
}

/** Manual trigger from Config → Context. Bypasses the once-per-day gate. */
export async function runMemoryCompileNow(): Promise<{ ok: true; result: CompileResult } | { ok: false; error: string }> {
  const memoryDir = getMemoryDir();
  const llm = await buildLLMFromSettings();
  if (llm == null) return { ok: false, error: "Add an OpenAI API key in Config before compiling context." };
  try {
    const result = await compileMemoriesIn(memoryDir, llm, new Date());
    return { ok: true, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await recordCompileError(memoryDir, message);
    return { ok: false, error: message };
  }
}

export async function getMemoryCompileStatus(): Promise<MemoryCompileState> {
  return loadCompileStateIn(getMemoryDir());
}

export function registerMemoryCompileHandlers(): void {
  ipcMain.handle("memory:runCompileNow", () => runMemoryCompileNow());
  ipcMain.handle("memory:getCompileStatus", () => getMemoryCompileStatus());
}
