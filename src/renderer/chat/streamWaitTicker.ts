export const STREAM_WAIT_LABEL = "THINKING";

export const STREAM_WAIT_HEX = "0123456789ABCDEF";

export const STREAM_WAIT_WORDS = [
  "THINKING",
  "WAITING",
  "HOLDING",
  "READING",
  "SEEKING",
  "SCANNING",
  "SORTING",
  "CASTING",
  "LOOKING",
  "FINDING",
  "SPINNING",
  "LOCKING",
  "LOADING",
  "PARSING",
  "TRACING",
  "SHIFTING",
] as const;

export interface StreamWaitTickerConfig {
  minLength: number;
  maxLength: number;
  wordChance: number;
  tickMs: number;
  minSpinMs: number;
  maxSpinMs: number;
  minHoldMs: number;
  maxHoldMs: number;
}

export const STREAM_WAIT_TICKER: StreamWaitTickerConfig = {
  minLength: 6,
  maxLength: 10,
  wordChance: 0.42,
  tickMs: 48,
  minSpinMs: 180,
  maxSpinMs: 520,
  minHoldMs: 220,
  maxHoldMs: 640,
};

export type StreamWaitTokenKind = "hex" | "word";

export interface StreamWaitToken {
  kind: StreamWaitTokenKind;
  text: string;
}

export interface StreamWaitTickerState {
  display: string;
  target: string;
  kind: StreamWaitTokenKind;
  spinning: boolean;
  until: number;
}

export type StreamWaitRng = () => number;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function pickRange(rng: StreamWaitRng, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(clamp01(rng()) * (hi - lo + 1));
}

export function pickHexGlyph(rng: StreamWaitRng): string {
  return STREAM_WAIT_HEX[Math.floor(clamp01(rng()) * STREAM_WAIT_HEX.length)] ?? "0";
}

export function scrambleHex(rng: StreamWaitRng, length: number): string {
  const n = Math.max(0, Math.floor(length));
  let out = "";
  for (let i = 0; i < n; i += 1) out += pickHexGlyph(rng);
  return out;
}

export function wordsInRange(minLength: number, maxLength: number): string[] {
  return STREAM_WAIT_WORDS.filter((word) => word.length >= minLength && word.length <= maxLength);
}

export function nextWaitToken(rng: StreamWaitRng, config: StreamWaitTickerConfig): StreamWaitToken {
  const words = wordsInRange(config.minLength, config.maxLength);
  if (words.length > 0 && rng() < config.wordChance) {
    const word = words[Math.floor(clamp01(rng()) * words.length)] ?? STREAM_WAIT_LABEL;
    return { kind: "word", text: word };
  }
  const length = pickRange(rng, config.minLength, config.maxLength);
  return { kind: "hex", text: scrambleHex(rng, length) };
}

export function createStreamWaitTickerState(
  now: number,
  rng: StreamWaitRng,
  config: StreamWaitTickerConfig = STREAM_WAIT_TICKER,
): StreamWaitTickerState {
  const token = nextWaitToken(rng, config);
  return {
    display: scrambleHex(rng, token.text.length),
    target: token.text,
    kind: token.kind,
    spinning: true,
    until: now + pickRange(rng, config.minSpinMs, config.maxSpinMs),
  };
}

export function stepStreamWaitTicker(
  state: StreamWaitTickerState,
  now: number,
  rng: StreamWaitRng,
  config: StreamWaitTickerConfig = STREAM_WAIT_TICKER,
): StreamWaitTickerState {
  if (now < state.until) {
    if (!state.spinning) return state;
    return { ...state, display: scrambleHex(rng, state.target.length) };
  }
  if (state.spinning) {
    return {
      ...state,
      display: state.target,
      spinning: false,
      until: now + pickRange(rng, config.minHoldMs, config.maxHoldMs),
    };
  }
  return createStreamWaitTickerState(now, rng, config);
}
