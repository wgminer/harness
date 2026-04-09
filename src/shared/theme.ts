/**
 * Theme settings (persisted as theme.json), Google Fonts URL, and CSS generation.
 */

export const FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 18] as const;

const GOOGLE_QUERY_PARTS = [
  "Inter:wght@400;500;600;700",
  "Open+Sans:wght@400;600;700",
  "Roboto:wght@400;500;700",
  "Lato:wght@400;700",
  "Nunito:wght@400;600;700",
  "Work+Sans:wght@400;600;700",
  "Source+Sans+3:wght@400;600;700",
  "Plus+Jakarta+Sans:wght@400;600;700",
  "Merriweather:wght@400;700",
  "Lora:wght@400;600;700",
  "Literata:wght@400;600;700",
  "JetBrains+Mono:wght@400;500;600",
  "Fira+Code:wght@400;500;600",
  "Source+Code+Pro:wght@400;600",
  "IBM+Plex+Mono:wght@400;600",
  "Roboto+Mono:wght@400;600",
  "Space+Mono:wght@400;700",
] as const;

export const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?" +
  GOOGLE_QUERY_PARTS.map((p) => `family=${p}`).join("&") +
  "&display=swap";

export const FONTS = [
  { id: "system", label: "System UI", stack: "system-ui, sans-serif" },
  {
    id: "ui_serif",
    label: "UI serif (system)",
    stack: 'ui-serif, "New York", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
  },
  { id: "inter", label: "Inter (Google)", stack: '"Inter", system-ui, sans-serif' },
  { id: "open_sans", label: "Open Sans (Google)", stack: '"Open Sans", system-ui, sans-serif' },
  { id: "roboto", label: "Roboto (Google)", stack: '"Roboto", system-ui, sans-serif' },
  { id: "lato", label: "Lato (Google)", stack: '"Lato", system-ui, sans-serif' },
  { id: "nunito", label: "Nunito (Google)", stack: '"Nunito", system-ui, sans-serif' },
  { id: "work_sans", label: "Work Sans (Google)", stack: '"Work Sans", system-ui, sans-serif' },
  { id: "source_sans_3", label: "Source Sans 3 (Google)", stack: '"Source Sans 3", system-ui, sans-serif' },
  { id: "plus_jakarta", label: "Plus Jakarta Sans (Google)", stack: '"Plus Jakarta Sans", system-ui, sans-serif' },
  { id: "merriweather", label: "Merriweather (Google)", stack: '"Merriweather", ui-serif, Georgia, serif' },
  { id: "lora", label: "Lora (Google)", stack: '"Lora", ui-serif, Georgia, serif' },
  { id: "literata", label: "Literata (Google)", stack: '"Literata", ui-serif, Georgia, serif' },
  {
    id: "sf",
    label: "System mono (SF / Cascadia)",
    stack: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
  },
  {
    id: "jetbrains",
    label: "JetBrains Mono (Google)",
    stack: '"JetBrains Mono", ui-monospace, Menlo, monospace',
  },
  { id: "fira_code", label: "Fira Code (Google)", stack: '"Fira Code", ui-monospace, monospace' },
  { id: "source_code", label: "Source Code Pro (Google)", stack: '"Source Code Pro", ui-monospace, monospace' },
  {
    id: "ibm_plex",
    label: "IBM Plex Mono (Google)",
    stack: '"IBM Plex Mono", ui-monospace, Menlo, Monaco, monospace',
  },
  { id: "roboto_mono", label: "Roboto Mono (Google)", stack: '"Roboto Mono", ui-monospace, monospace' },
  { id: "space_mono", label: "Space Mono (Google)", stack: '"Space Mono", ui-monospace, monospace' },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

export const FONT_STACKS = Object.fromEntries(FONTS.map((f) => [f.id, f.stack])) as Record<FontId, string>;

const FONT_ID_SET = new Set<string>(FONTS.map((f) => f.id));

export function isFontId(s: string): s is FontId {
  return FONT_ID_SET.has(s);
}

export function parseFontId(v: unknown): FontId | undefined {
  return typeof v === "string" && isFontId(v) ? v : undefined;
}

function parseHexAccent(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1];
  return h.length === 3 ? `#${h.split("").map((c) => c + c).join("")}` : `#${h}`;
}

export function normalizeColorPickerValue(hex: string): string {
  return parseHexAccent(hex) ?? "#000000";
}

export type ThemeSettings = {
  accent: string;
  font: FontId;
  fontSize: (typeof FONT_SIZE_OPTIONS)[number];
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  accent: "#f2ff00",
  font: "roboto",
  fontSize: 14,
};

function parseFontSizePx(raw: unknown): (typeof FONT_SIZE_OPTIONS)[number] | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.round(raw);
  return FONT_SIZE_OPTIONS.includes(n as (typeof FONT_SIZE_OPTIONS)[number])
    ? (n as (typeof FONT_SIZE_OPTIONS)[number])
    : undefined;
}

/** Coerce arbitrary JSON / IPC input into a valid theme. */
export function normalizeThemeSettings(input: unknown): ThemeSettings {
  const d = DEFAULT_THEME_SETTINGS;
  if (!input || typeof input !== "object") return { ...d };
  const o = input as Record<string, unknown>;

  const accent = typeof o.accent === "string" ? parseHexAccent(o.accent) : null;

  // Legacy compatibility: older theme files may store per-surface font fields.
  const legacyBodyFont = parseFontId(o.bodyFont);
  const legacyUiFont = parseFontId(o.uiFont);
  const legacyHeadingFont = parseFontId(o.headingFont);
  const legacyButtonFont = parseFontId(o.buttonFont);
  const legacyFont =
    parseFontId(o.font) ??
    legacyBodyFont ??
    legacyUiFont ??
    legacyHeadingFont ??
    legacyButtonFont;

  return {
    accent: accent ?? d.accent,
    font: legacyFont ?? d.font,
    fontSize: parseFontSizePx(o.fontSize) ?? d.fontSize,
  };
}

export function themeSettingsToCss(settings: ThemeSettings): string {
  const s = normalizeThemeSettings(settings);
  return `:root {
  --accent: ${s.accent.trim()};
  --font-family: ${FONT_STACKS[s.font]};
  --font-size: ${s.fontSize}px;
}`;
}

/** For inline preview in settings: CSS custom properties on a wrapper. */
export function themePreviewStyleVars(settings: ThemeSettings): Record<string, string> {
  const s = normalizeThemeSettings(settings);
  return {
    "--accent": s.accent.trim(),
    "--font-family": FONT_STACKS[s.font],
    "--font-size": `${s.fontSize}px`,
    "--line-height": "1.5",
  };
}

/** Valid font ids for tool / API schemas. */
export const FONT_IDS_FOR_SCHEMA: string[] = [...FONTS.map((f) => f.id)];
