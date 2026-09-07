import { useEffect, useState } from "react";
import {
  HEX_SCRAMBLE_REVEAL,
  createHexScrambleRevealState,
  stepHexScrambleReveal,
} from "./hexScrambleReveal";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** One-shot hex scramble that settles on `target`. Restarts when `active` becomes true. */
export function useHexScrambleReveal(
  target: string,
  active: boolean,
): { display: string; settled: boolean } {
  const [display, setDisplay] = useState(target);
  const [settled, setSettled] = useState(!active);

  useEffect(() => {
    if (!active) {
      setDisplay(target);
      setSettled(false);
      return;
    }
    if (prefersReducedMotion()) {
      setDisplay(target);
      setSettled(true);
      return;
    }

    let state = createHexScrambleRevealState(target, Date.now(), Math.random);
    setDisplay(state.display);
    setSettled(false);

    const timer = window.setInterval(() => {
      state = stepHexScrambleReveal(state, Date.now(), Math.random);
      setDisplay(state.display);
      if (!state.spinning) {
        setSettled(true);
        window.clearInterval(timer);
      }
    }, HEX_SCRAMBLE_REVEAL.tickMs);

    return () => window.clearInterval(timer);
  }, [active, target]);

  return { display, settled };
}
