import { describe, expect, it } from "vitest";
import {
  STREAM_WAIT_HEX,
  STREAM_WAIT_TICKER,
  STREAM_WAIT_WORDS,
  createStreamWaitTickerState,
  nextWaitToken,
  scrambleHex,
  stepStreamWaitTicker,
  wordsInRange,
} from "./streamWaitTicker";

function rngFrom(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe("scrambleHex", () => {
  it("emits only hex glyphs at the requested length", () => {
    const text = scrambleHex(() => 0.5, 6);
    expect(text).toHaveLength(6);
    expect([...text].every((ch) => STREAM_WAIT_HEX.includes(ch))).toBe(true);
  });
});

describe("nextWaitToken", () => {
  it("returns a word when chance is forced", () => {
    const token = nextWaitToken(rngFrom([0, 0]), { ...STREAM_WAIT_TICKER, wordChance: 1 });
    expect(token.kind).toBe("word");
    expect(STREAM_WAIT_WORDS).toContain(token.text);
  });

  it("returns hex within the length range when words are skipped", () => {
    const token = nextWaitToken(rngFrom([0.9, 0.2]), { ...STREAM_WAIT_TICKER, wordChance: 0 });
    expect(token.kind).toBe("hex");
    expect(token.text.length).toBeGreaterThanOrEqual(STREAM_WAIT_TICKER.minLength);
    expect(token.text.length).toBeLessThanOrEqual(STREAM_WAIT_TICKER.maxLength);
    expect([...token.text].every((ch) => STREAM_WAIT_HEX.includes(ch))).toBe(true);
  });

  it("keeps words inside the configured length window", () => {
    expect(wordsInRange(4, 5).every((word) => word.length >= 4 && word.length <= 5)).toBe(true);
  });
});

describe("stepStreamWaitTicker", () => {
  it("scrambles while spinning, then lands on the target", () => {
    const rng = rngFrom([0.9, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    const start = createStreamWaitTickerState(0, rng, {
      ...STREAM_WAIT_TICKER,
      wordChance: 0,
      minSpinMs: 100,
      maxSpinMs: 100,
      minHoldMs: 200,
      maxHoldMs: 200,
    });
    expect(start.spinning).toBe(true);
    expect(start.display).not.toBe(start.target);

    const mid = stepStreamWaitTicker(start, 50, rng);
    expect(mid.spinning).toBe(true);
    expect(mid.display).toHaveLength(start.target.length);

    const landed = stepStreamWaitTicker(mid, 100, rng);
    expect(landed.spinning).toBe(false);
    expect(landed.display).toBe(start.target);
  });
});
