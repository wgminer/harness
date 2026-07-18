import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";

interface JoyDivisionFieldProps {
  /** Live mic level 0..1; read every frame from a ref so parent re-renders are not required. */
  levelRef: RefObject<number> | MutableRefObject<number>;
  active: boolean;
  width?: number;
  height?: number;
  rowCount?: number;
  pointsPerRow?: number;
  className?: string;
}

type RidgeRow = {
  level: number;
  profile: Float32Array;
};

const PUSH_INTERVAL_MS = 70;
const FRAME_MS = 1000 / 24;
const IDLE_AMPLITUDE = 0.045;
const IDLE_THRESHOLD = 0.02;
/** Mic peaks are often small; boost before shaping so speech moves the field. */
const LEVEL_GAIN = 10;
const PEAK_ROW_MULTIPLES = 6.2;
const STROKE = "#ffffff";
const OCCLUSION = "#111111";

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function hash01(seed: number, index: number): number {
  let z = (Math.imul(seed ^ index, 0x9e3779b9) >>> 0) + 0x7f4a7c15;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return ((z ^ (z >>> 16)) >>> 0) / 0x100000000;
}

function valueNoise(t: number, seed: number, smooth: boolean): number {
  const i0 = Math.floor(t);
  const i1 = i0 + 1;
  const f = t - i0;
  const u = smooth ? f * f * (3 - 2 * f) : f;
  const a = hash01(seed, i0);
  const b = hash01(seed, i1);
  return a + (b - a) * u;
}

function jaggedNoise(t: number, seed: number): number {
  const coarse = valueNoise(t * 8.5, seed, false);
  const mid = valueNoise(t * 16 + 0.21, seed ^ 0xa5a5a5a5, false);
  const fine = valueNoise(t * 28 + 0.37, seed ^ 0xd1b54a32, false);
  const spike = valueNoise(t * 4.2 + 1.1, seed ^ 0x94d049bb, true);
  const shaped =
    Math.pow(coarse, 1.35) * 0.35 +
    mid * 0.2 +
    fine * 0.15 +
    Math.pow(Math.max(spike, 0), 2.4) * 0.85;
  return Math.max(0.02, Math.min(shaped, 1.55));
}

function makeProfile(seed: number, pointCount: number): Float32Array {
  const profile = new Float32Array(pointCount + 1);
  const sigma = 0.3;
  const twoSigmaSq = 2 * sigma * sigma;
  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const centered = (t - 0.5) * 2;
    const envelope = 0.02 + 0.98 * Math.exp(-(centered * centered) / twoSigmaSq);
    profile[i] = envelope * jaggedNoise(t, seed);
  }
  return profile;
}

function displayAmplitude(raw: number, nowMs: number): number {
  const boosted = Math.min(Math.max(raw, 0) * LEVEL_GAIN, 1);
  if (boosted < IDLE_THRESHOLD) {
    const breath = Math.sin((nowMs / 1000) * 1.4) * 0.5 + 0.5;
    return IDLE_AMPLITUDE * (0.55 + 0.45 * breath);
  }
  return Math.min(Math.max(Math.pow(boosted, 0.55), IDLE_AMPLITUDE), 1);
}

/**
 * Joy Division–style stacked ridgelines driven by a live mic level (0..1).
 * White strokes on dark occlusion; history scrolls continuously while active.
 */
export function JoyDivisionField({
  levelRef,
  active,
  width = 360,
  height = 400,
  rowCount = 40,
  pointsPerRow = 48,
  className,
}: JoyDivisionFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rowsRef = useRef<RidgeRow[]>([]);
  const pushSeedRef = useRef(0xc0ffee00);
  const lastPushAtRef = useRef(0);
  const reducedRef = useRef(prefersReducedMotion());

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      reducedRef.current = mq.matches;
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!active) {
      rowsRef.current = [];
      lastPushAtRef.current = 0;
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const seedRows = () => {
      const count = Math.max(pointsPerRow, 8);
      const rows: RidgeRow[] = [];
      for (let index = 0; index < rowCount; index++) {
        const seed = Math.imul(index + 1, 0x9e3779b9) >>> 0;
        rows.push({
          level: IDLE_AMPLITUDE * (0.4 + (0.6 * (index % 5)) / 4),
          profile: makeProfile(seed, count),
        });
      }
      rowsRef.current = rows;
    };

    const pushRow = (raw: number, now: number) => {
      if (rowsRef.current.length !== rowCount) seedRows();
      if (now - lastPushAtRef.current < PUSH_INTERVAL_MS) return;
      lastPushAtRef.current = now;

      let seed = (Math.imul(pushSeedRef.current, 0xbf58476d) + 0x9e3779b9) >>> 0;
      pushSeedRef.current = seed;

      const count = Math.max(pointsPerRow, 8);
      const next = rowsRef.current.slice(1);
      next.push({
        level: displayAmplitude(raw, now),
        profile: makeProfile(seed, count),
      });
      while (next.length < rowCount) {
        seed = (Math.imul(seed, 0x94d049bb) + 1) >>> 0;
        pushSeedRef.current = seed;
        next.unshift({
          level: IDLE_AMPLITUDE,
          profile: makeProfile(seed, count),
        });
      }
      rowsRef.current = next.length > rowCount ? next.slice(-rowCount) : next;
    };

    const draw = (now: number) => {
      const rows = rowsRef.current;
      if (rowCount < 2 || rows.length === 0) return;

      const insetX = width * 0.06;
      const insetY = height * 0.08;
      const plotW = width - insetX * 2;
      const plotH = height - insetY * 2;
      const rowSpacing = plotH / (rowCount - 1);
      const peakScale = rowSpacing * PEAK_ROW_MULTIPLES;
      const occludeDepth = peakScale + rowSpacing;
      const liveAmp = displayAmplitude(levelRef.current ?? 0, now);

      ctx.clearRect(0, 0, width, height);

      for (let index = 0; index < rows.length; index++) {
        const row = rows[index]!;
        const baselineY = insetY + index * rowSpacing;
        const amplitude = index === rows.length - 1 ? liveAmp : row.level;
        const profile = row.profile;
        const lastIndex = profile.length - 1;
        if (lastIndex < 1) continue;

        const invLast = 1 / lastIndex;
        const fillBottom = Math.min(insetY + plotH + 2, baselineY + occludeDepth);

        ctx.beginPath();
        const x0 = insetX;
        const y0 = baselineY - profile[0]! * amplitude * peakScale;
        ctx.moveTo(x0, fillBottom);
        ctx.lineTo(x0, y0);
        for (let i = 1; i <= lastIndex; i++) {
          const x = insetX + i * invLast * plotW;
          const y = baselineY - profile[i]! * amplitude * peakScale;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(insetX + plotW, fillBottom);
        ctx.closePath();
        ctx.fillStyle = OCCLUSION;
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(x0, y0);
        for (let i = 1; i <= lastIndex; i++) {
          const x = insetX + i * invLast * plotW;
          const y = baselineY - profile[i]! * amplitude * peakScale;
          ctx.lineTo(x, y);
        }
        ctx.strokeStyle = STROKE;
        ctx.lineWidth = 1.25;
        ctx.lineJoin = "miter";
        ctx.lineCap = "butt";
        ctx.stroke();
      }
    };

    seedRows();
    let raf = 0;
    let lastFrame = 0;
    let cancelled = false;

    const tick = (now: number) => {
      if (cancelled) return;
      raf = requestAnimationFrame(tick);
      if (document.hidden) return;

      // Always advance history while active so the field scrolls continuously
      // (idle breath + mic peaks), unless the user prefers reduced motion.
      if (!reducedRef.current) {
        pushRow(levelRef.current ?? 0, now);
      }

      if (now - lastFrame >= FRAME_MS) {
        lastFrame = now;
        draw(now);
      }
    };

    draw(performance.now());
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [active, width, height, rowCount, pointsPerRow, levelRef]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className={className ?? "joy-division-field"}
      width={width}
      height={height}
      style={{ width, height }}
      aria-hidden
    />
  );
}
