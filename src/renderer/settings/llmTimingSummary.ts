import type { LlmTiming } from "../../shared/desktopAPI";

const KIND_LABELS: Record<LlmTiming["kind"], string> = {
  chat: "Chat",
  title: "Title",
  json: "JSON",
  cleanup: "Dictation cleanup",
  image: "Image",
  imageEdit: "Image edit",
};

export function llmTimingKindLabel(kind: LlmTiming["kind"]): string {
  return KIND_LABELS[kind] ?? kind;
}

export function formatSeconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** One-line median summary of successful chat rounds, or null when there are none. */
export function summarizeChatTimings(timings: LlmTiming[]): string | null {
  const ok = timings.filter((t) => t.kind === "chat" && t.outcome === "ok");
  const total = median(ok.map((t) => t.totalMs));
  if (total == null) return null;
  const first = median(
    ok.flatMap((t) => (t.firstTokenMs != null ? [t.firstTokenMs] : [])),
  );
  const parts = [
    first != null ? `first token ${formatSeconds(first)}` : null,
    `total ${formatSeconds(total)}`,
  ].filter(Boolean);
  return `Chat median over ${ok.length} round${ok.length === 1 ? "" : "s"}: ${parts.join(", ")}.`;
}
