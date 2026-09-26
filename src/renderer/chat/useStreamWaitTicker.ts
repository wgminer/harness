import { useEffect, useState } from "react";
import {
  STREAM_WAIT_LABEL,
  STREAM_WAIT_TICKER,
  createStreamWaitTickerState,
  stepStreamWaitTicker,
} from "./streamWaitTicker";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useStreamWaitTicker(): string {
  const [display, setDisplay] = useState(STREAM_WAIT_LABEL);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDisplay(STREAM_WAIT_LABEL);
      return;
    }

    let state = createStreamWaitTickerState(Date.now(), Math.random);
    setDisplay(state.display);
    const timer = window.setInterval(() => {
      state = stepStreamWaitTicker(state, Date.now(), Math.random);
      setDisplay(state.display);
    }, STREAM_WAIT_TICKER.tickMs);

    return () => window.clearInterval(timer);
  }, []);

  return display;
}
