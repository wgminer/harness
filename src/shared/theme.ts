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

export type ThemePreset = {
  id: string;
  label: string;
  theme: ThemeSettings;
};

/** Full themes (colors + fonts + size) for quick selection in Theme studio. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "midnight",
    label: "Midnight",
    theme: { ...DEFAULT_THEME_SETTINGS },
  },
  {
    id: "paper",
    label: "Paper",
    theme: {
      accent: "#2563eb",
      font: "inter",
      fontMono: "jetbrains",
      fontSize: 14,
      fg: "#171717",
      bg: "#fafafa",
    },
  },
  {
    id: "synthwave",
    label: "Synthwave",
    theme: {
      accent: "#f472b6",
      font: "plus_jakarta",
      fontMono: "fira_code",
      fontSize: 14,
      fg: "#f5d0fe",
      bg: "#1a0533",
    },
  },
  {
    id: "neon_slime",
    label: "Neon slime",
    theme: {
      accent: "#bef264",
      font: "work_sans",
      fontMono: "jetbrains",
      fontSize: 14,
      fg: "#ecfccb",
      bg: "#052e16",
    },
  },
  {
    id: "lava_core",
    label: "Lava core",
    theme: {
      accent: "#fb923c",
      font: "lora",
      fontMono: "source_code",
      fontSize: 15,
      fg: "#fee2e2",
      bg: "#1c0808",
    },
  },
  {
    id: "electric",
    label: "Electric",
    theme: {
      accent: "#38bdf8",
      font: "inter",
      fontMono: "space_mono",
      fontSize: 14,
      fg: "#e0e7ff",
      bg: "#020617",
    },
  },
  {
    id: "dracula",
    label: "Dracula",
    theme: {
      accent: "#bd93f9",
      font: "nunito",
      fontMono: "jetbrains",
      fontSize: 14,
      fg: "#f8f8f2",
      bg: "#282a36",
    },
  },
  {
    id: "unicorn",
    label: "Unicorn",
    theme: {
      accent: "#e879f9",
      font: "nunito",
      fontMono: "fira_code",
      fontSize: 14,
      fg: "#581c87",
      bg: "#faf5ff",
    },
  },
  {
    id: "copper_rust",
    label: "Copper rust",
    theme: {
      accent: "#f59e0b",
      font: "merriweather",
      fontMono: "ibm_plex",
      fontSize: 14,
      fg: "#fce7f3",
      bg: "#292524",
    },
  },
  {
    id: "glitch_city",
    label: "Glitch city",
    theme: {
      accent: "#22d3ee",
      font: "plus_jakarta",
      fontMono: "roboto_mono",
      fontSize: 14,
      fg: "#fae8ff",
      bg: "#0f0518",
    },
  },
  {
    id: "matcha_latte",
    label: "Matcha latte",
    theme: {
      accent: "#84cc16",
      font: "literata",
      fontMono: "source_code",
      fontSize: 15,
      fg: "#365314",
      bg: "#f7fee7",
    },
  },
  {
    id: "blood_orange",
    label: "Blood orange",
    theme: {
      accent: "#fb923c",
      font: "open_sans",
      fontMono: "sf",
      fontSize: 14,
      fg: "#7c2d12",
      bg: "#fff7ed",
    },
  },
  {
    id: "void_caller",
    label: "Void caller",
    theme: {
      accent: "#a855f7",
      font: "source_sans_3",
      fontMono: "space_mono",
      fontSize: 14,
      fg: "#e4e4e7",
      bg: "#09090b",
    },
  },
  {
    id: "tropical_punch",
    label: "Tropical punch",
    theme: {
      accent: "#f472b6",
      font: "work_sans",
      fontMono: "jetbrains",
      fontSize: 14,
      fg: "#ccfbf1",
      bg: "#042f2e",
    },
  },
  {
    id: "crt_green",
    label: "CRT green",
    theme: {
      accent: "#4ade80",
      font: "roboto",
      fontMono: "roboto_mono",
      fontSize: 14,
      fg: "#bbf7d0",
      bg: "#0a150a",
    },
  },
];

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

/** Whether two themes match for preset highlighting (normalized hex + font fields). */
export function themeMatchesPreset(a: ThemeSettings, b: ThemeSettings): boolean {
  const na = normalizeThemeSettings(a);
  const nb = normalizeThemeSettings(b);
  return (
    normalizeColorPickerValue(na.bg) === normalizeColorPickerValue(nb.bg) &&
    normalizeColorPickerValue(na.fg) === normalizeColorPickerValue(nb.fg) &&
    normalizeColorPickerValue(na.accent) === normalizeColorPickerValue(nb.accent) &&
    na.font === nb.font &&
    na.fontMono === nb.fontMono &&
    na.fontSize === nb.fontSize
  );
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
