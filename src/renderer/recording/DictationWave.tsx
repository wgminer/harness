import { useEffect, useRef } from "react";
import { getTakeLevel } from "./dictationTake";

const SAMPLE_MS = 50;
const BAR_WIDTH = 2;
const BAR_GAP = 2;
/** Mic peaks are often small; boost before shaping so speech moves the bars. */
const LEVEL_GAIN = 6;

/**
 * Scrolling level meter for the active take: one bar per sample, newest at the
 * right. Sizes to its box and draws in the element's text color.
 */
export function DictationWave({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const bars: number[] = [];

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      const step = BAR_WIDTH + BAR_GAP;
      const capacity = Math.max(1, Math.floor((width + BAR_GAP) / step));
      if (bars.length > capacity) bars.splice(0, bars.length - capacity);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = getComputedStyle(canvas).color;
      const mid = height / 2;
      for (let i = 0; i < capacity; i++) {
        // Right-align: slots left of the oldest sample draw as the resting line.
        const value = bars[i - (capacity - bars.length)] ?? 0;
        const barHeight = Math.max(BAR_WIDTH, value * height);
        ctx.globalAlpha = value > 0 ? 1 : 0.35;
        ctx.fillRect(i * step, mid - barHeight / 2, BAR_WIDTH, barHeight);
      }
      ctx.globalAlpha = 1;
    };

    const sample = () => {
      bars.push(Math.min(1, Math.sqrt(getTakeLevel() * LEVEL_GAIN)));
      draw();
    };

    draw();
    const timer = setInterval(sample, SAMPLE_MS);
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => {
      clearInterval(timer);
      observer.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
