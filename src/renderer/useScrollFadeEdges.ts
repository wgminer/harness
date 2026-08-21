import { useRef, useState, useCallback, useEffect } from "react";

/**
 * Tracks whether a scrollable container can scroll up/down,
 * for showing edge fade overlays at the top and bottom.
 */
export function useScrollFadeEdges(threshold = 1) {
  const scrollRef = useRef<HTMLUListElement>(null);
  const [fadeTop, setFadeTop] = useState(false);
  const [fadeBottom, setFadeBottom] = useState(false);

  const syncFadeEdges = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const nextTop = scrollTop > threshold;
    const nextBottom = scrollTop + clientHeight < scrollHeight - threshold;
    // Scroll fires continuously; bail out when the edges haven't actually flipped.
    setFadeTop((prev) => (prev === nextTop ? prev : nextTop));
    setFadeBottom((prev) => (prev === nextBottom ? prev : nextBottom));
  }, [threshold]);

  const onScroll = useCallback(() => {
    syncFadeEdges();
  }, [syncFadeEdges]);

  useEffect(() => {
    syncFadeEdges();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => syncFadeEdges());
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncFadeEdges]);

  return { scrollRef, fadeTop, fadeBottom, onScroll };
}
