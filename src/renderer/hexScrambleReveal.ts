import { pickHexGlyph, type StreamWaitRng } from "./streamWaitTicker";

export interface HexScrambleRevealConfig {
  tickMs: number;
  minSpinMs: number;
  maxSpinMs: number;
}

/** One-shot scramble → settle (unlike the looping stream-wait ticker). */
export const HEX_SCRAMBLE_REVEAL: HexScrambleRevealConfig = {
  tickMs: 48,
  minSpinMs: 4_000,
  maxSpinMs: 4_000,
};

export interface HexScrambleRevealState {
  display: string;
  target: string;
  spinning: boolean;
  until: number;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function pickRange(rng: StreamWaitRng, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(clamp01(rng()) * (hi - lo + 1));
}

/** Hex-scramble non-whitespace; keep spaces/punctuation slots stable. */
export function scrambleTowardTarget(target: string, rng: StreamWaitRng): string {
  let out = "";
  for (const ch of target) {
    if (/\s/.test(ch)) out += ch;
    else out += pickHexGlyph(rng);
  }
  return out;
}

export function createHexScrambleRevealState(
  target: string,
  now: number,
  rng: StreamWaitRng,
  config: HexScrambleRevealConfig = HEX_SCRAMBLE_REVEAL,
): HexScrambleRevealState {
  return {
    display: scrambleTowardTarget(target, rng),
    target,
    spinning: true,
    until: now + pickRange(rng, config.minSpinMs, config.maxSpinMs),
  };
}

export function stepHexScrambleReveal(
  state: HexScrambleRevealState,
  now: number,
  rng: StreamWaitRng,
): HexScrambleRevealState {
  if (!state.spinning) return state;
  if (now < state.until) {
    return { ...state, display: scrambleTowardTarget(state.target, rng) };
  }
  return { ...state, display: state.target, spinning: false };
}
