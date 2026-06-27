/** Duration for dark ↔ light color cross-fades (see `.theme-animate` in base.css). */
export const THEME_COLOR_TRANSITION_MS = 2800;

let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** Cross-fade painted colors after theme CSS variables change. Respects reduced motion. */
export function beginThemeColorTransition(): void {
  if (typeof document === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const root = document.documentElement;
  root.classList.add("theme-animate");
  if (clearTimer !== undefined) window.clearTimeout(clearTimer);
  clearTimer = window.setTimeout(() => {
    root.classList.remove("theme-animate");
    clearTimer = undefined;
  }, THEME_COLOR_TRANSITION_MS);
}

export function themeColorsChanged(
  before: { bg: string; fg: string; accent: string },
  after: { bg: string; fg: string; accent: string },
): boolean {
  return before.bg !== after.bg || before.fg !== after.fg || before.accent !== after.accent;
}
