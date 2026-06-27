import { useRef, useState, useCallback, useEffect } from "react";

/**
 * Tracks whether a scrollable container has scrolled past a threshold,
 * useful for adding a shadow/border to a fixed workspace header.
 */
export function useScrolledHeader(threshold = 1) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  const syncScrolled = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setScrolled(el.scrollTop > threshold);
  }, [threshold]);

  const onScroll = useCallback(() => {
    syncScrolled();
  }, [syncScrolled]);

  useEffect(() => {
    syncScrolled();
  }, [syncScrolled]);

  return { scrollRef, scrolled, onScroll };
}
