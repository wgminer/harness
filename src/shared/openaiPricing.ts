/**
 * OpenAI Standard-tier list prices (USD per 1M tokens).
 * Source: https://developers.openai.com/api/docs/pricing
 */

export interface ModelTokenUsage {
  promptTokens: number;
  cachedPromptTokens: number;
  completionTokens: number;
}

export interface ModelPricePerMillion {
  inputUsd: number;
  cachedInputUsd: number;
  outputUsd: number;
}

/** Standard-tier rates for Harness pinned models. */
export const OPENAI_STANDARD_PRICING: Record<string, ModelPricePerMillion> = {
  "gpt-5.4": { inputUsd: 2.5, cachedInputUsd: 0.25, outputUsd: 15 },
  "gpt-5.4-mini": { inputUsd: 0.75, cachedInputUsd: 0.075, outputUsd: 4.5 },
  "gpt-5.4-nano": { inputUsd: 0.2, cachedInputUsd: 0.02, outputUsd: 1.25 },
};

const FALLBACK_MODEL = "gpt-5.4";

export function pricingForModel(model: string): ModelPricePerMillion {
  return OPENAI_STANDARD_PRICING[model] ?? OPENAI_STANDARD_PRICING[FALLBACK_MODEL]!;
}

/** Estimated USD from token counts and Standard list prices. */
export function estimateModelCostUsd(model: string, tokens: ModelTokenUsage): number {
  const rates = pricingForModel(model);
  const cached = Math.min(Math.max(0, tokens.cachedPromptTokens), Math.max(0, tokens.promptTokens));
  const uncachedPrompt = Math.max(0, tokens.promptTokens - cached);
  const completion = Math.max(0, tokens.completionTokens);
  const inputCost = (uncachedPrompt / 1_000_000) * rates.inputUsd;
  const cachedCost = (cached / 1_000_000) * rates.cachedInputUsd;
  const outputCost = (completion / 1_000_000) * rates.outputUsd;
  return inputCost + cachedCost + outputCost;
}

/** Sum estimated USD across multiple models for one month bucket. */
export function estimateMonthCostUsd(
  byModel: Record<string, ModelTokenUsage>
): number {
  let total = 0;
  for (const [model, tokens] of Object.entries(byModel)) {
    total += estimateModelCostUsd(model, tokens);
  }
  return total;
}

/** UTC calendar month key, e.g. "2026-05". */
export function utcMonthKey(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Human label for a month key, e.g. "May 2026 (UTC)". */
export function utcMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return `${monthKey} (UTC)`;
  const d = new Date(Date.UTC(y, m - 1, 1));
  const monthName = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return `${monthName} ${y} (UTC)`;
}
