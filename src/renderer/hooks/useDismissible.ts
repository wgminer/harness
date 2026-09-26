import { useEffect, useRef, type RefObject } from "react";

export type UseDismissibleOptions = {
  open: boolean;
  onDismiss: () => void;
  /** When set, pointer-down outside these elements dismisses. */
  refs?: ReadonlyArray<RefObject<HTMLElement | null>>;
  /** Pointer event name for outside-click. Default `mousedown`. */
  pointerEvent?: "mousedown" | "pointerdown";
  /** Capture-phase listener for outside-click. Default `false`. */
  capture?: boolean;
  /** Dismiss on Escape. Default `true`. */
  escape?: boolean;
  /** Call `preventDefault` on Escape. Default `false`. */
  preventEscapeDefault?: boolean;
};

/**
 * Dismiss an open menu/overlay on Escape and/or pointer-down outside `refs`.
 * Omit `refs` (or pass `[]`) for Escape-only dismissal.
 */
export function useDismissible({
  open,
  onDismiss,
  refs,
  pointerEvent = "mousedown",
  capture = false,
  escape = true,
  preventEscapeDefault = false,
}: UseDismissibleOptions): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  const refsRef = useRef(refs);
  refsRef.current = refs;

  const listenOutside = Boolean(refs && refs.length > 0);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (!escape || e.key !== "Escape") return;
      if (preventEscapeDefault) e.preventDefault();
      onDismissRef.current();
    };

    const onPointer = (e: Event) => {
      const list = refsRef.current;
      if (!list || list.length === 0) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (list.some((ref) => ref.current?.contains(target))) return;
      onDismissRef.current();
    };

    window.addEventListener("keydown", onKeyDown);
    if (listenOutside) {
      window.addEventListener(pointerEvent, onPointer, capture);
    }
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (listenOutside) {
        window.removeEventListener(pointerEvent, onPointer, capture);
      }
    };
  }, [open, listenOutside, pointerEvent, capture, escape, preventEscapeDefault]);
}
