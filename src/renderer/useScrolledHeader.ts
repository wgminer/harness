import { useRef, useState, useCallback } from "react";

/**
 * Tracks whether a scrollable container has scrolled past a threshold,
 * useful for adding a shadow/border to a sticky header.
 */
export function useScrolledHeader(threshold = 12) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrolled(el.scrollTop > threshold);
  }, [threshold]);

  return { scrollRef, scrolled, onScroll };
}
