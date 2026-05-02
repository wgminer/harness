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
  { id: "system", label: "System UI", stack: "system-ui, sans-serif", category: "ui" as const },
  {
    id: "ui_serif",
    label: "UI serif (system)",
    stack: 'ui-serif, "New York", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    category: "ui" as const,
  },
  { id: "inter", label: "Inter (Google)", stack: '"Inter", system-ui, sans-serif', category: "ui" as const },
  { id: "open_sans", label: "Open Sans (Google)", stack: '"Open Sans", system-ui, sans-serif', category: "ui" as const },
  { id: "roboto", label: "Roboto (Google)", stack: '"Roboto", system-ui, sans-serif', category: "ui" as const },
  { id: "lato", label: "Lato (Google)", stack: '"Lato", system-ui, sans-serif', category: "ui" as const },
  { id: "nunito", label: "Nunito (Google)", stack: '"Nunito", system-ui, sans-serif', category: "ui" as const },
  { id: "work_sans", label: "Work Sans (Google)", stack: '"Work Sans", system-ui, sans-serif', category: "ui" as const },
  { id: "source_sans_3", label: "Source Sans 3 (Google)", stack: '"Source Sans 3", system-ui, sans-serif', category: "ui" as const },
  { id: "plus_jakarta", label: "Plus Jakarta Sans (Google)", stack: '"Plus Jakarta Sans", system-ui, sans-serif', category: "ui" as const },
  { id: "merriweather", label: "Merriweather (Google)", stack: '"Merriweather", ui-serif, Georgia, serif', category: "ui" as const },
  { id: "lora", label: "Lora (Google)", stack: '"Lora", ui-serif, Georgia, serif', category: "ui" as const },
  { id: "literata", label: "Literata (Google)", stack: '"Literata", ui-serif, Georgia, serif', category: "ui" as const },
  {
    id: "sf",
    label: "System mono (SF / Cascadia)",
    stack: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
    category: "mono" as const,
  },
  {
    id: "jetbrains",
    label: "JetBrains Mono (Google)",
    stack: '"JetBrains Mono", ui-monospace, Menlo, monospace',
    category: "mono" as const,
  },
  { id: "fira_code", label: "Fira Code (Google)", stack: '"Fira Code", ui-monospace, monospace', category: "mono" as const },
  { id: "source_code", label: "Source Code Pro (Google)", stack: '"Source Code Pro", ui-monospace, monospace', category: "mono" as const },
  {
    id: "ibm_plex",
    label: "IBM Plex Mono (Google)",
    stack: '"IBM Plex Mono", ui-monospace, Menlo, Monaco, monospace',
    category: "mono" as const,
  },
  { id: "roboto_mono", label: "Roboto Mono (Google)", stack: '"Roboto Mono", ui-monospace, monospace', category: "mono" as const },
  { id: "space_mono", label: "Space Mono (Google)", stack: '"Space Mono", ui-monospace, monospace', category: "mono" as const },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

export const UI_FONTS = FONTS.filter((f) => f.category === "ui");
export const MONO_FONTS = FONTS.filter((f) => f.category === "mono");

export type UiFontId = (typeof UI_FONTS)[number]["id"];
export type MonoFontId = (typeof MONO_FONTS)[number]["id"];

const MONO_FONT_ID_SET = new Set<string>(MONO_FONTS.map((f) => f.id));
const UI_FONT_ID_SET = new Set<string>(UI_FONTS.map((f) => f.id));

export function isMonoFontId(id: string): id is MonoFontId {
  return MONO_FONT_ID_SET.has(id);
}

export function isUiFontId(id: string): id is UiFontId {
  return UI_FONT_ID_SET.has(id);
}

export const FONT_STACKS = Object.fromEntries(FONTS.map((f) => [f.id, f.stack])) as Record<FontId, string>;

const FONT_ID_SET = new Set<string>(FONTS.map((f) => f.id));

export function isFontId(s: string): s is FontId {
  return FONT_ID_SET.has(s);
}

export function parseFontId(v: unknown): FontId | undefined {
  return typeof v === "string" && isFontId(v) ? v : undefined;
}

export function parseUiFontId(v: unknown): UiFontId | undefined {
  const id = parseFontId(v);
  return id && isUiFontId(id) ? id : undefined;
}

export function parseMonoFontId(v: unknown): MonoFontId | undefined {
  const id = parseFontId(v);
  return id && isMonoFontId(id) ? id : undefined;
}

export function parseHexColor(raw: string | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const h = m[1];
  return h.length === 3 ? `#${h.split("").map((c) => c + c).join("")}` : `#${h}`;
}

export function normalizeColorPickerValue(hex: string): string {
  return parseHexColor(hex) ?? "#000000";
}

const VERY_LOW_CONTRAST_TRIGGER = 1.25;
const MIN_FORCED_CONTRAST = 2.0;

function hexToRgb(hex: string): [number, number, number] | null {
  const normalized = parseHexColor(hex);
  if (!normalized) return null;
  const v = normalized.slice(1);
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function srgbChannelToLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map(srgbChannelToLinear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatioHex(a: string, b: string): number {
  const ar = hexToRgb(a);
  const br = hexToRgb(b);
  if (!ar || !br) return Number.POSITIVE_INFINITY;
  const l1 = relativeLuminance(ar);
  const l2 = relativeLuminance(br);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixRgb(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const m = (x: number, y: number) => Math.round(x + (y - x) * t);
  return [m(a[0], b[0]), m(a[1], b[1]), m(a[2], b[2])];
}

function minimallyAdjustForContrast(adjustable: string, fixed: string, targetContrast: number): string {
  const start = hexToRgb(adjustable);
  if (!start) return adjustable;
  const black: [number, number, number] = [0, 0, 0];
  const white: [number, number, number] = [255, 255, 255];
  const bestEndpoint =
    contrastRatioHex(rgbToHex(black), fixed) > contrastRatioHex(rgbToHex(white), fixed) ? black : white;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) / 2;
    const candidate = rgbToHex(mixRgb(start, bestEndpoint, mid));
    if (contrastRatioHex(candidate, fixed) >= targetContrast) {
      high = mid;
    } else {
      low = mid;
    }
  }
  return rgbToHex(mixRgb(start, bestEndpoint, high));
}

/**
 * Only intervenes when contrast is extremely poor.
 * Keeps the changed side fixed and minimally nudges the opposite side.
 */
export function enforceVeryLowContrastGuard(
  colors: Pick<ThemeSettings, "fg" | "bg">,
  lock: "fg" | "bg",
): Pick<ThemeSettings, "fg" | "bg"> {
  const fg = parseHexColor(colors.fg) ?? colors.fg;
  const bg = parseHexColor(colors.bg) ?? colors.bg;
  if (contrastRatioHex(fg, bg) >= VERY_LOW_CONTRAST_TRIGGER) return { fg, bg };
  if (lock === "fg") {
    return { fg, bg: minimallyAdjustForContrast(bg, fg, MIN_FORCED_CONTRAST) };
  }
  return { fg: minimallyAdjustForContrast(fg, bg, MIN_FORCED_CONTRAST), bg };
}

export type ThemeSettings = {
  accent: string;
  font: UiFontId;
  fontMono: MonoFontId;
  fontSize: (typeof FONT_SIZE_OPTIONS)[number];
  fg: string;
  bg: string;
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  accent: "#f2ff00",
  font: "inter",
  fontMono: "jetbrains",
  fontSize: 14,
  fg: "#e6edf3",
  bg: "#0d1117",
};

export const DEFAULT_ACCENT_SWATCHES = [
  "#f2ff00",
  "#ffe066",
  "#ffb703",
  "#fb8500",
  "#ff7f50",
  "#f94144",
  "#ef476f",
  "#d00000",
  "#9d0208",
  "#c9184a",
  "#ff4d6d",
  "#ff8fab",
  "#c77dff",
  "#9d4edd",
  "#7b2cbf",
  "#5a189a",
  "#3a0ca3",
  "#4361ee",
  "#4895ef",
  "#4cc9f0",
] as const;

/** Curated text tones across light and dark themes (includes default `fg`). */
export const DEFAULT_FG_SWATCHES = [
  "#e6edf3",
  "#f0f6fc",
  "#c9d1d9",
  "#d1d9e0",
  "#e2e8f0",
  "#f5f5f4",
  "#eceff4",
  "#d8dee9",
  "#cdd6f4",
  "#f8fafc",
  "#111827",
  "#1f2937",
  "#374151",
  "#4b5563",
  "#0f172a",
  "#334155",
  "#3f3f46",
  "#27272a",
  "#1e293b",
  "#000000",
] as const;

/** Curated dark and light surfaces (includes default `bg`). */
export const DEFAULT_BG_SWATCHES = [
  "#0d1117",
  "#161b22",
  "#0f1419",
  "#1a1b26",
  "#1e1e2e",
  "#11111b",
  "#0c0c0c",
  "#181825",
  "#252526",
  "#1e2030",
  "#f8fafc",
  "#f1f5f9",
  "#e2e8f0",
  "#f5f5f4",
  "#f4f4f5",
  "#ecfeff",
  "#eef2ff",
  "#faf5ff",
  "#fef3c7",
  "#ffffff",
] as const;

function parseFontSizePx(raw: unknown): (typeof FONT_SIZE_OPTIONS)[number] | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const n = Math.round(raw);
  return FONT_SIZE_OPTIONS.includes(n as (typeof FONT_SIZE_OPTIONS)[number])
    ? (n as (typeof FONT_SIZE_OPTIONS)[number])
    : undefined;
}

function themeResolvedCssVars(s: ThemeSettings): Record<string, string> {
  const accent = s.accent.trim();
  const fg = s.fg.trim();
  const bg = s.bg.trim();
  return {
    "--accent": accent,
    "--fg": fg,
    "--bg": bg,
    "--fg-muted": `color-mix(in oklab, ${fg} 60%, ${bg})`,
    "--bg-secondary": `color-mix(in oklab, ${bg} 92%, ${fg})`,
    "--bg-elevated": `color-mix(in oklab, ${bg} 84%, ${fg})`,
    "--border": `color-mix(in oklab, ${bg} 80%, ${fg})`,
    "--accent-readable": `color-mix(in oklab, ${accent} 70%, ${fg})`,
    "--selection-bg": `color-mix(in srgb, ${accent} 38%, ${fg} 22%)`,
    "--sidebar-control-hover-bg": `color-mix(in srgb, ${fg} 10%, var(--bg-secondary))`,
    "--sidebar-control-active-hover-bg": `color-mix(in srgb, ${accent} 72%, var(--bg-secondary))`,
    "--font-family": FONT_STACKS[s.font],
    "--font-family-mono": FONT_STACKS[s.fontMono],
    "--font-size": `${s.fontSize}px`,
  };
}

/** Coerce arbitrary JSON / IPC input into a valid theme. */
export function normalizeThemeSettings(input: unknown): ThemeSettings {
  const d = DEFAULT_THEME_SETTINGS;
  if (!input || typeof input !== "object") return { ...d };
  const o = input as Record<string, unknown>;

  const accent = typeof o.accent === "string" ? parseHexColor(o.accent) : null;
  const fg = typeof o.fg === "string" ? parseHexColor(o.fg) : null;
  const bg = typeof o.bg === "string" ? parseHexColor(o.bg) : null;

  const legacyBodyFont = parseFontId(o.bodyFont);
  const legacyUiFont = parseFontId(o.uiFont);
  const legacyHeadingFont = parseFontId(o.headingFont);
  const legacyButtonFont = parseFontId(o.buttonFont);
  const legacyPrimary =
    parseFontId(o.font) ?? legacyBodyFont ?? legacyUiFont ?? legacyHeadingFont ?? legacyButtonFont;

  const explicitMono = parseMonoFontId(o.fontMono);

  let fontMono: MonoFontId = explicitMono ?? d.fontMono;
  let font: UiFontId = d.font;

  const uiCandidate =
    parseUiFontId(o.font) ??
    parseUiFontId(legacyUiFont) ??
    parseUiFontId(legacyBodyFont) ??
    parseUiFontId(legacyHeadingFont) ??
    parseUiFontId(legacyButtonFont);
  if (uiCandidate) {
    font = uiCandidate;
  } else if (legacyPrimary && isUiFontId(legacyPrimary)) {
    font = legacyPrimary;
  }

  if (explicitMono) {
    fontMono = explicitMono;
  } else if (legacyPrimary && isMonoFontId(legacyPrimary)) {
    fontMono = legacyPrimary;
  }

  return {
    accent: accent ?? d.accent,
    font,
    fontMono,
    fontSize: parseFontSizePx(o.fontSize) ?? d.fontSize,
    fg: fg ?? d.fg,
    bg: bg ?? d.bg,
  };
}

export function themeSettingsToCss(settings: ThemeSettings): string {
  const s = normalizeThemeSettings(settings);
  const vars = themeResolvedCssVars(s);
  const body = Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `:root {\n${body}\n}`;
}

/** UI font ids only (for update_theme.font). */
export const FONT_UI_IDS_FOR_SCHEMA: string[] = [...UI_FONTS.map((f) => f.id)];

/** Monospace font ids only (for update_theme.fontMono). */
export const FONT_MONO_IDS_FOR_SCHEMA: string[] = [...MONO_FONTS.map((f) => f.id)];
