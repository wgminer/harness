/** Default desktop accent — must match `--accent` in `src/renderer/base.css`. */
export const DEFAULT_ACCENT = "#5b9cf5";

/** Curated accents tuned for dark UI — saturated enough to pop, not neon. */
export const ACCENT_PRESETS: ReadonlyArray<{ id: string; label: string; hex: string }> = [
  { id: "sky", label: "Sky", hex: DEFAULT_ACCENT },
  { id: "glacier", label: "Glacier", hex: "#3ecfcf" },
  { id: "iris", label: "Iris", hex: "#8b8ff5" },
  { id: "orchid", label: "Orchid", hex: "#c084fc" },
  { id: "blush", label: "Blush", hex: "#f4729a" },
  { id: "ember", label: "Ember", hex: "#ff7e5f" },
  { id: "honey", label: "Honey", hex: "#f0b429" },
  { id: "lime", label: "Lime", hex: "#b4e645" },
];

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalize a user/settings accent to `#rrggbb`, or fall back to the default. */
export function normalizeAccentHex(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_ACCENT;
  const trimmed = raw.trim();
  const match = HEX_RE.exec(trimmed);
  if (!match) return DEFAULT_ACCENT;
  const digits = match[1];
  if (digits.length === 3) {
    return `#${digits
      .split("")
      .map((c) => c + c)
      .join("")
      .toLowerCase()}`;
  }
  return `#${digits.toLowerCase()}`;
}

/** Whether `raw` is a valid 3- or 6-digit hex color (with `#`). */
export function isValidAccentHex(raw: string): boolean {
  return HEX_RE.test(raw.trim());
}

/** Apply accent to the document; CSS derives muted/readable/button variants. */
export function applyAccent(hex: unknown, root: HTMLElement = document.documentElement): void {
  root.style.setProperty("--accent", normalizeAccentHex(hex));
}
