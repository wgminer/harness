import { useEffect, useRef, useState } from "react";

/** ~80 chars/sec — clear immediately, then type out quickly. */
const MS_PER_CHAR = 12;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * On target change: clear immediately, then type the new string quickly.
 * Skips animation on first mount and when the user prefers reduced motion.
 */
export function useTypedPlaceholder(target: string): string {
  const [displayed, setDisplayed] = useState(target);
  const prevTarget = useRef<string | null>(null);

  useEffect(() => {
    if (prevTarget.current === null) {
      prevTarget.current = target;
      setDisplayed(target);
      return;
    }
    if (prevTarget.current === target) return;
    prevTarget.current = target;

    if (prefersReducedMotion()) {
      setDisplayed(target);
      return;
    }

    setDisplayed("");
    if (target.length === 0) return;

    let i = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const step = () => {
      i += 1;
      setDisplayed(target.slice(0, i));
      if (i < target.length) {
        timer = setTimeout(step, MS_PER_CHAR);
      }
    };

    timer = setTimeout(step, MS_PER_CHAR);
    return () => {
      if (timer != null) clearTimeout(timer);
    };
  }, [target]);

  return displayed;
}
