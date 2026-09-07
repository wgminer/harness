import { describe, expect, it } from "vitest";
import { STREAM_WAIT_HEX } from "./streamWaitTicker";
import {
  createHexScrambleRevealState,
  scrambleTowardTarget,
  stepHexScrambleReveal,
} from "./hexScrambleReveal";

function rngFrom(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe("scrambleTowardTarget", () => {
  it("keeps whitespace and hex-scrambles other glyphs", () => {
    const text = scrambleTowardTarget("Hi there", () => 0.5);
    expect(text).toBe("88 88888");
    expect(text).toHaveLength(8);
    expect([...text].every((ch) => ch === " " || STREAM_WAIT_HEX.includes(ch))).toBe(true);
  });
});

describe("stepHexScrambleReveal", () => {
  it("scrambles while spinning, then settles once", () => {
    const rng = rngFrom([0.5, 0.1, 0.2, 0.3, 0.4]);
    const start = createHexScrambleRevealState("Welcome", 0, rng, {
      tickMs: 48,
      minSpinMs: 100,
      maxSpinMs: 100,
    });
    expect(start.spinning).toBe(true);
    expect(start.display).not.toBe("Welcome");

    const mid = stepHexScrambleReveal(start, 50, rng);
    expect(mid.spinning).toBe(true);

    const landed = stepHexScrambleReveal(mid, 100, rng);
    expect(landed.spinning).toBe(false);
    expect(landed.display).toBe("Welcome");

    const held = stepHexScrambleReveal(landed, 500, rng);
    expect(held).toEqual(landed);
  });
});
