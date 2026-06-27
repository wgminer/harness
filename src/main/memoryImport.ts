import { ipcMain } from "electron";
import OpenAI from "openai";
import { getMemoryDir, getUserMemoryIn, setUserMemoryIn } from "./memory";
import {
  mergeFacts,
  parseFactsResponse,
  type DistilledFact,
  type MemoryCompileLLM,
} from "./memoryCompile";
import { resolveOpenAIApiKey } from "./settings";
import { OPENAI_TRANSCRIPT_CLEANUP_MODEL } from "../shared/openaiModels";
import { RIG_PAGE_TITLE } from "../shared/rigPage";

/** Cap pasted export size so a single import stays predictable. */
export const LLM_CONTEXT_IMPORT_CHAR_LIMIT = 80_000;

const IMPORT_SYSTEM_PROMPT = [
  "You are importing a structured memory export from another AI assistant into a personal workspace user-fact store.",
  "Each fact uses a short lowercase snake_case key (max 40 chars) and a one-line value (max 200 chars).",
  "Extract durable facts from every section of the export. Preserve verbatim wording in values when it captures instructions, preferences, or quoted evidence.",
  "Use distinct keys per fact (e.g. preferred_name, profession, interest_climbing, instruction_never_use_em_dashes).",
  "Include dates in values when the export provides them.",
  "Do not invent facts that are not supported by the export.",
  'Output strict JSON with this exact shape and nothing else:',
  '{ "facts": [ { "key": "snake_case_label", "value": "one-line detail" } ] }',
  'If nothing usable is present, output { "facts": [] }.',
].join("\n");

/** Final line must be `Imported from: <source>` per the export prompt. */
export function parseImportSource(exportText: string): string | null {
  const trimmed = exportText.trim();
  if (!trimmed) return null;
  const lastLine = trimmed.split(/\r?\n/).pop()?.trim() ?? "";
  const match = lastLine.match(/^Imported from:\s*(.+)$/i);
  return match ? match[1].trim() : null;
}

export function truncateExportForImport(exportText: string): { text: string; truncated: boolean } {
  const trimmed = exportText.trim();
  if (trimmed.length <= LLM_CONTEXT_IMPORT_CHAR_LIMIT) {
    return { text: trimmed, truncated: false };
  }
  return {
    text: trimmed.slice(0, LLM_CONTEXT_IMPORT_CHAR_LIMIT),
    truncated: true,
  };
}

function sourceFact(source: string): DistilledFact {
  return { key: "context_import_source", value: source };
}

export function createOpenAIImportDistiller(apiKey: string): MemoryCompileLLM {
  const client = new OpenAI({ apiKey });
  return {
    async distill(exportText: string): Promise<DistilledFact[]> {
      const completion = await client.chat.completions.create(
        {
          model: OPENAI_TRANSCRIPT_CLEANUP_MODEL,
          messages: [
            { role: "system", content: IMPORT_SYSTEM_PROMPT },
            { role: "user", content: exportText },
          ],
          response_format: { type: "json_object" },
          max_completion_tokens: 2500,
        },
        { signal: AbortSignal.timeout(90_000) }
      );
      const raw = completion.choices[0]?.message?.content?.trim() ?? "";
      return parseFactsResponse(raw);
    },
  };
}

export interface LlmContextImportResult {
  added: number;
  updated: number;
  truncated: boolean;
  importSource: string | null;
}

export async function importLlmContextIn(
  memoryDir: string,
  llm: MemoryCompileLLM,
  exportText: string
): Promise<LlmContextImportResult> {
  const { text, truncated } = truncateExportForImport(exportText);
  if (!text) {
    return { added: 0, updated: 0, truncated: false, importSource: null };
  }

  const importSource = parseImportSource(text);
  let facts = await llm.distill(text);
  if (importSource) {
    facts = [...facts.filter((f) => f.key.toLowerCase() !== "context_import_source"), sourceFact(importSource)];
  }

  const existing = await getUserMemoryIn(memoryDir);
  const { merged, added, updated } = mergeFacts(existing, facts);
  for (const [key, value] of Object.entries(merged)) {
    if (existing[key] !== value) {
      await setUserMemoryIn(memoryDir, key, value);
    }
  }

  return { added, updated, truncated, importSource };
}

async function buildImportLLMFromSettings(): Promise<MemoryCompileLLM | null> {
  const apiKey = (await resolveOpenAIApiKey()).trim();
  if (!apiKey) return null;
  return createOpenAIImportDistiller(apiKey);
}

export async function runLlmContextImportNow(
  exportText: string
): Promise<{ ok: true; result: LlmContextImportResult } | { ok: false; error: string }> {
  const trimmed = exportText.trim();
  if (!trimmed) {
    return { ok: false, error: "Paste an export from another assistant before importing." };
  }
  const llm = await buildImportLLMFromSettings();
  if (llm == null) {
    return { ok: false, error: `Add an OpenAI API key in ${RIG_PAGE_TITLE} before importing context.` };
  }
  try {
    const result = await importLlmContextIn(getMemoryDir(), llm, trimmed);
    if (result.added === 0 && result.updated === 0) {
      return { ok: false, error: "No facts could be extracted from that export. Check the format and try again." };
    }
    return { ok: true, result };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: message };
  }
}

export function registerMemoryImportHandlers(): void {
  ipcMain.handle("memory:importLlmContext", (_e, exportText: string) => runLlmContextImportNow(exportText));
}
