import type { CSSProperties } from "react";

/**
 * Animated rim around the compose-mode composer. Values map 1:1 onto the
 * `--rim-*` custom properties consumed by `composerRim.css`.
 */
export const COMPOSER_RIM_PATTERNS = ["off", "rainbow", "comet", "duo", "breathe", "aurora"] as const;
export type ComposerRimPattern = (typeof COMPOSER_RIM_PATTERNS)[number];

export const COMPOSER_RIM_WHEN = ["always", "idle", "focus"] as const;
export type ComposerRimWhen = (typeof COMPOSER_RIM_WHEN)[number];

export const COMPOSER_RIM_COLORS = ["accent", "custom"] as const;
export type ComposerRimColor = (typeof COMPOSER_RIM_COLORS)[number];

export type ComposerRimSettings = {
  pattern: ComposerRimPattern;
  when: ComposerRimWhen;
  /** `accent` follows `--accent`; `custom` uses hue / chroma / lightness. */
  color: ComposerRimColor;
  /** Rim thickness at exhale, px. */
  width: number;
  /** Extra thickness at the top of each breath, px. */
  swell: number;
  /** Seconds per full rotation / drift cycle. 0 = static. */
  spinSeconds: number;
  /** Seconds per pulse cycle. 0 = no pulse. */
  pulseSeconds: number;
  /** Opacity at exhale, relative to peak (0-1). */
  pulseFloor: number;
  /** Base hue (degrees). */
  hue: number;
  /** Hue range covered by duo / comet / aurora (degrees). */
  hueSpread: number;
  /** oklch chroma (0-0.37). */
  chroma: number;
  /** oklch lightness (0-1). */
  lightness: number;
  /** Rim opacity (0-1). */
  rimOpacity: number;
  /** Glow blur radius, px. */
  glowBlur: number;
  /** Glow opacity (0-1). */
  glowOpacity: number;
  /** How far the glow extends past the composer edge, px. */
  glowSpread: number;
  /** Opaque tint behind the glass so the glow does not bleed through (0-1). */
  glassFill: number;
};

export const DEFAULT_COMPOSER_RIM: ComposerRimSettings = {
  pattern: "breathe",
  when: "always",
  color: "accent",
  width: 1,
  swell: 0.75,
  spinSeconds: 8,
  pulseSeconds: 7,
  pulseFloor: 0.35,
  hue: 250,
  hueSpread: 24,
  chroma: 0.16,
  lightness: 0.74,
  rimOpacity: 0.85,
  glowBlur: 20,
  glowOpacity: 0.3,
  glowSpread: 2,
  glassFill: 0.6,
};

type NumericKey = {
  [K in keyof ComposerRimSettings]: ComposerRimSettings[K] extends number ? K : never;
}[keyof ComposerRimSettings];

export type ComposerRimRange = {
  key: NumericKey;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  /** Only meaningful when `color` is `custom`. */
  customOnly?: boolean;
};

/** Slider ranges, in jig display order. */
export const COMPOSER_RIM_RANGES: ComposerRimRange[] = [
  { key: "width", label: "Width", min: 0.5, max: 6, step: 0.25, unit: "px" },
  { key: "swell", label: "Swell", min: 0, max: 3, step: 0.25, unit: "px" },
  { key: "rimOpacity", label: "Rim opacity", min: 0, max: 1, step: 0.05 },
  { key: "spinSeconds", label: "Spin", min: 0, max: 30, step: 0.5, unit: "s" },
  { key: "pulseSeconds", label: "Breath", min: 0, max: 20, step: 0.5, unit: "s" },
  { key: "pulseFloor", label: "Pulse floor", min: 0, max: 1, step: 0.05 },
  { key: "hue", label: "Hue", min: 0, max: 360, step: 1, unit: "°", customOnly: true },
  { key: "hueSpread", label: "Hue spread", min: 0, max: 360, step: 5, unit: "°" },
  { key: "chroma", label: "Chroma", min: 0, max: 0.37, step: 0.01, customOnly: true },
  { key: "lightness", label: "Lightness", min: 0.2, max: 1, step: 0.01, customOnly: true },
  { key: "glowOpacity", label: "Glow opacity", min: 0, max: 1, step: 0.05 },
  { key: "glowBlur", label: "Glow blur", min: 0, max: 60, step: 1, unit: "px" },
  { key: "glowSpread", label: "Glow spread", min: -8, max: 24, step: 1, unit: "px" },
  { key: "glassFill", label: "Glass fill", min: 0, max: 1, step: 0.05 },
];

export const COMPOSER_RIM_STORAGE_KEY = "harness.composer-rim.v2";

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export function parseComposerRimSettings(raw: string | null): ComposerRimSettings {
  if (!raw) return { ...DEFAULT_COMPOSER_RIM };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof ComposerRimSettings, unknown>>;
    const next: ComposerRimSettings = { ...DEFAULT_COMPOSER_RIM };
    if (COMPOSER_RIM_PATTERNS.includes(parsed.pattern as ComposerRimPattern)) {
      next.pattern = parsed.pattern as ComposerRimPattern;
    }
    if (COMPOSER_RIM_WHEN.includes(parsed.when as ComposerRimWhen)) {
      next.when = parsed.when as ComposerRimWhen;
    }
    if (COMPOSER_RIM_COLORS.includes(parsed.color as ComposerRimColor)) {
      next.color = parsed.color as ComposerRimColor;
    }
    for (const range of COMPOSER_RIM_RANGES) {
      next[range.key] = clamp(parsed[range.key], range.min, range.max, DEFAULT_COMPOSER_RIM[range.key]);
    }
    return next;
  } catch {
    return { ...DEFAULT_COMPOSER_RIM };
  }
}

export function readComposerRimSettings(): ComposerRimSettings {
  try {
    return parseComposerRimSettings(window.localStorage.getItem(COMPOSER_RIM_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_COMPOSER_RIM };
  }
}

export function writeComposerRimSettings(settings: ComposerRimSettings): void {
  try {
    window.localStorage.setItem(COMPOSER_RIM_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

/** Custom properties for the composer host. Durations of 0 pause that animation. */
export function composerRimVars(s: ComposerRimSettings): Record<string, string> {
  return {
    "--rim-width": `${s.width}px`,
    "--rim-swell": `${s.pulseSeconds > 0 ? s.swell : 0}px`,
    "--rim-spin-duration": `${s.spinSeconds || 1}s`,
    "--rim-spin-state": s.spinSeconds > 0 ? "running" : "paused",
    "--rim-pulse-duration": `${s.pulseSeconds || 1}s`,
    "--rim-pulse-state": s.pulseSeconds > 0 ? "running" : "paused",
    "--rim-pulse-floor": `${s.pulseSeconds > 0 ? s.pulseFloor : 1}`,
    "--rim-hue": `${s.hue}`,
    "--rim-hue-spread": `${s.hueSpread}`,
    "--rim-chroma": `${s.chroma}`,
    "--rim-lightness": `${s.lightness}`,
    "--rim-opacity": `${s.rimOpacity}`,
    "--rim-glow-blur": `${s.glowBlur}px`,
    "--rim-glow-opacity": `${s.glowOpacity}`,
    "--rim-glow-spread": `${s.glowSpread}px`,
    "--rim-glass-fill": `${Math.round(s.glassFill * 100)}%`,
  };
}

export function composerRimStyle(s: ComposerRimSettings): CSSProperties {
  return composerRimVars(s) as CSSProperties;
}

/** CSS block to paste back into `composerRim.css` once a look is picked. */
export function composerRimCssSnippet(s: ComposerRimSettings): string {
  const lines = Object.entries(composerRimVars(s)).map(([k, v]) => `  ${k}: ${v};`);
  return `/* pattern: ${s.pattern}, when: ${s.when}, color: ${s.color} */\n.new-chat-composer {\n${lines.join("\n")}\n}`;
}
