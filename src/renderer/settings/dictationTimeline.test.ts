import { describe, expect, it } from "vitest";
import type { DictationStep, DictationTiming } from "../../shared/desktopAPI";
import { dictationTimeline, formatSeconds } from "./dictationTimeline";

function step(name: string, startMs: number, durationMs: number): DictationStep {
  return { name, startMs, durationMs, outcome: "ok" };
}

function timing(partial: Partial<DictationTiming>): DictationTiming {
  return { id: "d", startedAt: 0, steps: [], ...partial };
}

describe("dictationTimeline", () => {
  it("spans to the last step and marks steps after ready", () => {
    const t = dictationTimeline(
      timing({
        readyMs: 2000,
        steps: [
          step("Title", 2000, 2000),
          step("Transcribe", 0, 1000),
          step("Cleanup", 1000, 1000),
          step("Reply action", 2000, 1000),
        ],
      }),
    );
    expect(t.spanMs).toBe(4000);
    expect(t.readyPct).toBe(50);
    expect(t.rows.map((r) => r.step.name)).toEqual([
      "Transcribe",
      "Cleanup",
      "Title",
      "Reply action",
    ]);
    expect(t.rows.map((r) => [r.leftPct, r.widthPct, r.afterReady])).toEqual([
      [0, 25, false],
      [25, 25, false],
      [50, 50, true],
      [50, 25, true],
    ]);
  });

  it("keeps tiny bars visible and inside the track", () => {
    const t = dictationTimeline(
      timing({ readyMs: 10_000, steps: [step("Paste", 10_000, 1)] }),
    );
    expect(t.rows[0].widthPct).toBeGreaterThan(0);
    expect(t.rows[0].leftPct + t.rows[0].widthPct).toBeLessThanOrEqual(100);
  });

  it("has no ready mark for an unfinished dictation", () => {
    expect(dictationTimeline(timing({ steps: [step("Transcribe", 0, 500)] })).readyPct).toBeNull();
  });
});

describe("formatSeconds", () => {
  it("keeps a decimal under ten seconds", () => {
    expect(formatSeconds(1234)).toBe("1.2s");
    expect(formatSeconds(12_600)).toBe("13s");
  });
});
