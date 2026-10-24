import type { DictationStep, DictationTiming } from "../../shared/desktopAPI";

export interface TimelineRow {
  step: DictationStep;
  leftPct: number;
  widthPct: number;
  /** Started after the text was delivered (title, reply action). */
  afterReady: boolean;
}

export interface Timeline {
  /** End of the last step or the ready mark, whichever is later. */
  spanMs: number;
  readyPct: number | null;
  rows: TimelineRow[];
}

const MIN_BAR_PCT = 0.75;

export function formatSeconds(ms: number): string {
  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

export function dictationTimeline(timing: DictationTiming): Timeline {
  const steps = [...timing.steps].sort((a, b) => a.startMs - b.startMs);
  const spanMs = Math.max(
    1,
    timing.readyMs ?? 0,
    ...steps.map((s) => s.startMs + s.durationMs),
  );
  const pct = (ms: number) => (ms / spanMs) * 100;
  return {
    spanMs,
    readyPct: timing.readyMs != null ? pct(timing.readyMs) : null,
    rows: steps.map((step) => {
      const leftPct = Math.min(pct(step.startMs), 100 - MIN_BAR_PCT);
      return {
        step,
        leftPct,
        widthPct: Math.min(Math.max(pct(step.durationMs), MIN_BAR_PCT), 100 - leftPct),
        afterReady: timing.readyMs != null && step.startMs >= timing.readyMs,
      };
    }),
  };
}
