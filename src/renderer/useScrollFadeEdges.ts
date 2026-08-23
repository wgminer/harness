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
    setFadeTop(scrollTop > threshold);
    setFadeBottom(scrollTop + clientHeight < scrollHeight - threshold);
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
