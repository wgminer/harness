import { useCallback, useEffect, useRef, useState } from "react";

export const COPY_FEEDBACK_MS = 2000;

/**
 * Local “Copied!” feedback after a successful clipboard write.
 * Clears after {@link COPY_FEEDBACK_MS} (or `resetMs`).
 */
export function useCopyFeedback(resetMs = COPY_FEEDBACK_MS) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const markCopied = useCallback(() => {
    setCopied(true);
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, resetMs);
  }, [resetMs]);

  const clear = useCallback(() => {
    if (timerRef.current != null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setCopied(false);
  }, []);

  const copyText = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
        markCopied();
        return true;
      } catch {
        return false;
      }
    },
    [markCopied],
  );

  return { copied, copyText, markCopied, clear };
}

/**
 * Parent-controlled copy feedback: call after a successful write, then
 * `onClear` fires after `resetMs` (e.g. `onCopied(null)`).
 */
export function scheduleCopyFeedbackClear(
  onClear: () => void,
  resetMs = COPY_FEEDBACK_MS,
): number {
  return window.setTimeout(onClear, resetMs);
}
