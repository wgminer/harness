/**
 * Theme settings (persisted as theme.json), Google Fonts URL, and CSS generation.
 */

export const FONT_SIZE_OPTIONS = [12, 14, 16] as const;

export type FontSizePx = (typeof FONT_SIZE_OPTIONS)[number];

/** Semantic type and icon sizes on the 4px grid for each user base font size. */
export function typeScaleCssVars(fontSize: FontSizePx): Record<string, string> {
  const scales: Record<
    FontSizePx,
    {
      caption: number;
      body: number;
      ui: number;
      title: number;
      iconXs: number;
      iconSm: number;
      iconMd: number;
      iconLg: number;
      iconXl: number;
      lhCaption: number;
      lhUi: number;
      lhBody: number;
      lhTitle: number;
      lhMessage: number;
      lhProse: number;
      lhCompact: number;
      lhSnug: number;
      lhNormal: number;
    }
  > = {
    12: {
      caption: 12,
      body: 12,
      ui: 12,
      title: 14,
      iconXs: 12,
      iconSm: 12,
      iconMd: 12,
      iconLg: 16,
      iconXl: 16,
      lhCaption: 16,
      lhUi: 16,
      lhBody: 16,
      lhTitle: 20,
      lhMessage: 20,
      lhProse: 24,
      lhCompact: 16,
      lhSnug: 16,
      lhNormal: 20,
    },
    14: {
      caption: 12,
      body: 14,
      ui: 12,
      title: 16,
      iconXs: 12,
      iconSm: 12,
      iconMd: 16,
      iconLg: 16,
      iconXl: 20,
      lhCaption: 16,
      lhUi: 16,
      lhBody: 20,
      lhTitle: 24,
      lhMessage: 24,
      lhProse: 28,
      lhCompact: 16,
      lhSnug: 20,
      lhNormal: 20,
    },
    16: {
      caption: 12,
      body: 16,
      ui: 16,
      title: 20,
      iconXs: 12,
      iconSm: 12,
      iconMd: 16,
      iconLg: 20,
      iconXl: 20,
      lhCaption: 16,
      lhUi: 24,
      lhBody: 24,
      lhTitle: 28,
      lhMessage: 28,
      lhProse: 32,
      lhCompact: 20,
      lhSnug: 20,
      lhNormal: 24,
    },
  };
  const s = scales[fontSize];
  return {
    "--font-size-caption": `${s.caption}px`,
    "--font-size-body": `${s.body}px`,
    "--font-size-ui": `${s.ui}px`,
    "--font-size-title": `${s.title}px`,
    "--icon-size-xs": `${s.iconXs}px`,
    "--icon-size-sm": `${s.iconSm}px`,
    "--icon-size-md": `${s.iconMd}px`,
    "--icon-size-lg": `${s.iconLg}px`,
    "--icon-size-xl": `${s.iconXl}px`,
    "--icon-size-compact": `${s.body}px`,
    "--line-height-tight": "16px",
    "--line-height-caption": `${s.lhCaption}px`,
    "--line-height-ui": `${s.lhUi}px`,
    "--line-height-body": `${s.lhBody}px`,
    "--line-height-title": `${s.lhTitle}px`,
    "--line-height-message": `${s.lhMessage}px`,
    "--line-height-prose": `${s.lhProse}px`,
    "--line-height-compact": `${s.lhCompact}px`,
    "--line-height-snug": `${s.lhSnug}px`,
    "--line-height-normal": `${s.lhNormal}px`,
    "--line-height": `${s.lhBody}px`,
  };
}

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
  "Coral+Pixels:wght@400",
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

export const SYSTEM_SERIF_STACK =
  'ui-serif, "New York", "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

export const FONTS = [
  { id: "system", label: "System UI", stack: "system-ui, sans-serif", category: "ui" as const },
  {
    id: "ui_serif",
    label: "System serif - Apple",
    stack: SYSTEM_SERIF_STACK,
    category: "both" as const,
  },
  { id: "inter", label: "Inter - Google", stack: '"Inter", system-ui, sans-serif', category: "ui" as const },
  { id: "open_sans", label: "Open Sans - Google", stack: '"Open Sans", system-ui, sans-serif', category: "ui" as const },
  { id: "roboto", label: "Roboto - Google", stack: '"Roboto", system-ui, sans-serif', category: "ui" as const },
  { id: "lato", label: "Lato - Google", stack: '"Lato", system-ui, sans-serif', category: "ui" as const },
  { id: "nunito", label: "Nunito - Google", stack: '"Nunito", system-ui, sans-serif', category: "ui" as const },
  { id: "work_sans", label: "Work Sans - Google", stack: '"Work Sans", system-ui, sans-serif', category: "ui" as const },
  { id: "source_sans_3", label: "Source Sans 3 - Google", stack: '"Source Sans 3", system-ui, sans-serif', category: "ui" as const },
  { id: "plus_jakarta", label: "Plus Jakarta Sans - Google", stack: '"Plus Jakarta Sans", system-ui, sans-serif', category: "ui" as const },
  { id: "merriweather", label: "Merriweather - Google", stack: '"Merriweather", ui-serif, Georgia, serif', category: "ui" as const },
  { id: "lora", label: "Lora - Google", stack: '"Lora", ui-serif, Georgia, serif', category: "ui" as const },
  { id: "literata", label: "Literata - Google", stack: '"Literata", ui-serif, Georgia, serif', category: "ui" as const },
  { id: "coral_pixels", label: "Coral Pixels - Google", stack: '"Coral Pixels", system-ui, sans-serif', category: "ui" as const },
  {
    id: "sf",
    label: "System mono - SF / Cascadia",
    stack: 'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", monospace',
    category: "mono" as const,
  },
  {
    id: "jetbrains",
    label: "JetBrains Mono - Google",
    stack: '"JetBrains Mono", ui-monospace, Menlo, monospace',
    category: "mono" as const,
  },
  { id: "fira_code", label: "Fira Code - Google", stack: '"Fira Code", ui-monospace, monospace', category: "mono" as const },
  { id: "source_code", label: "Source Code Pro - Google", stack: '"Source Code Pro", ui-monospace, monospace', category: "mono" as const },
  {
    id: "ibm_plex",
    label: "IBM Plex Mono - Google",
    stack: '"IBM Plex Mono", ui-monospace, Menlo, Monaco, monospace',
    category: "mono" as const,
  },
  { id: "roboto_mono", label: "Roboto Mono - Google", stack: '"Roboto Mono", ui-monospace, monospace', category: "mono" as const },
  { id: "space_mono", label: "Space Mono - Google", stack: '"Space Mono", ui-monospace, monospace', category: "mono" as const },
] as const;

export type FontId = (typeof FONTS)[number]["id"];

export const UI_FONTS = FONTS.filter((f) => f.category === "ui" || f.category === "both");
/** Code / notes editor fonts (monospace and proportional). */
export const MONO_FONTS = FONTS.filter((f) => f.category === "mono" || f.category === "both");

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

export type ThemeColors = {
  accent: string;
  fg: string;
  bg: string;
};

export type ThemeSettings = ThemeColors & {
  font: UiFontId;
  fontMono: MonoFontId;
  fontSize: FontSizePx;
};

export const DEFAULT_THEME_COLORS: ThemeColors = {
  accent: "#5b9cf5",
  fg: "#eceef2",
  bg: "#0b0d10",
};

export const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  ...DEFAULT_THEME_COLORS,
  font: "system",
  fontMono: "sf",
  fontSize: 14,
};

export type ThemePreset = {
  id: string;
  label: string;
  colors: ThemeColors;
};

/** Two built-in color themes. Typography is configured separately. */
export const THEME_PRESETS: readonly ThemePreset[] = [
  { id: "dark", label: "Dark", colors: { ...DEFAULT_THEME_COLORS } },
  {
    id: "light",
    label: "Light",
    colors: { accent: "#3b6fd9", fg: "#141820", bg: "#ffffff" },
  },
] as const;

/** Colors from removed green/blue presets — used to migrate saved themes on load. */
const LEGACY_REMOVED_PRESET_COLORS: readonly ThemeColors[] = [
  { accent: "#32d74b", fg: "#b8f5a8", bg: "#031508" },
  { accent: "#0091ff", fg: "#b8dcff", bg: "#010810" },
];

/** Previous default dark/light palettes before the blue accent refresh. */
const LEGACY_DEFAULT_DARK_COLORS: ThemeColors = {
  accent: "#f2ff00",
  fg: "#f5f5f5",
  bg: "#050505",
};

const LEGACY_DEFAULT_LIGHT_COLORS: ThemeColors = {
  accent: "#0052ff",
  fg: "#0a0a0a",
  bg: "#fafafa",
};

/** Previous light preset before the whiter background refresh. */
const LEGACY_GRAY_LIGHT_COLORS: ThemeColors = {
  accent: "#3b6fd9",
  fg: "#141820",
  bg: "#f6f7f9",
};

/** Legacy preset ids still accepted by tools and older backups. */
export const THEME_PRESET_ALIASES: Readonly<Record<string, string>> = {
  night: "dark",
  paper: "light",
  green: "dark",
  matcha: "dark",
  blue: "dark",
  ik_blue: "dark",
  bloomberg: "dark",
};

/** Resolve a preset id, including legacy aliases. */
export function resolveThemePresetId(raw: string): string | undefined {
  const id = raw.trim().toLowerCase();
  const resolved = THEME_PRESET_ALIASES[id] ?? id;
  return THEME_PRESETS.some((p) => p.id === resolved) ? resolved : undefined;
}

export function findThemePreset(id: string): ThemePreset | undefined {
  const resolved = resolveThemePresetId(id);
  return resolved ? THEME_PRESETS.find((p) => p.id === resolved) : undefined;
}

/** Apply a color palette to existing theme settings without changing typography. */
export function applyThemeColors(settings: ThemeSettings, colors: ThemeColors): ThemeSettings {
  return { ...settings, ...colors };
}

function parseFontSizePx(raw: unknown): FontSizePx | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return coerceFontSizePx(Math.round(raw));
}

/** Step base font size through allowed px values. */
export function stepFontSize(current: FontSizePx, delta: -1 | 1): FontSizePx {
  const idx = FONT_SIZE_OPTIONS.indexOf(current);
  const baseIdx = idx >= 0 ? idx : FONT_SIZE_OPTIONS.indexOf(DEFAULT_THEME_SETTINGS.fontSize);
  const next = baseIdx + delta;
  if (next <= 0) return FONT_SIZE_OPTIONS[0];
  if (next >= FONT_SIZE_OPTIONS.length) return FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1];
  return FONT_SIZE_OPTIONS[next];
}

/** Snap an arbitrary px value to the nearest allowed base font size. */
export function coerceFontSizePx(raw: number): FontSizePx {
  let closest: FontSizePx = FONT_SIZE_OPTIONS[0];
  let minDist = Math.abs(raw - closest);
  for (const opt of FONT_SIZE_OPTIONS) {
    const dist = Math.abs(raw - opt);
    if (dist < minDist || (dist === minDist && opt > closest)) {
      minDist = dist;
      closest = opt;
    }
  }
  return closest;
}

/** Whether the theme background reads as light (for surface mix + mobile chrome). */
export function isLightThemeBackground(bg: string): boolean {
  const rgb = hexToRgb(parseHexColor(bg) ?? bg);
  if (!rgb) return false;
  return relativeLuminance(rgb) > 0.55;
}

/** Neutral used only for light-theme borders and elevation — never mix near-black fg into white surfaces. */
const LIGHT_SURFACE_NEUTRAL = "#b8bcc4";

type ThemeSurfaceMix = {
  fgMutedFgPct: number;
  bgSecondaryBgPct: number;
  bgElevatedBgPct: number;
  borderLightBgPct: number;
  borderDarkBgPct: number;
  accentReadableAccentPct: number;
  selectionAccentPct: number;
  sidebarActiveAccentPct: number;
  sidebarHoverFgPct: number;
};

function themeSurfaceMix(): ThemeSurfaceMix {
  return {
    fgMutedFgPct: 70,
    bgSecondaryBgPct: 88,
    bgElevatedBgPct: 78,
    borderLightBgPct: 78,
    borderDarkBgPct: 72,
    accentReadableAccentPct: 86,
    selectionAccentPct: 80,
    sidebarActiveAccentPct: 88,
    sidebarHoverFgPct: 14,
  };
}

/** Dark-theme surface tone pulls fg toward accent so panels keep chromatic punch. */
function themeSurfaceTone(fg: string, accent: string): string {
  return `color-mix(in oklab, ${fg} 74%, ${accent})`;
}

function themeResolvedCssVars(s: ThemeSettings): Record<string, string> {
  const accent = s.accent.trim();
  const fg = s.fg.trim();
  const bg = s.bg.trim();
  const typography = {
    "--font-family": FONT_STACKS[s.font],
    "--font-family-mono": FONT_STACKS[s.fontMono],
    "--font-size": `${s.fontSize}px`,
    ...typeScaleCssVars(s.fontSize),
  };

  if (isLightThemeBackground(bg)) {
    const neutral = LIGHT_SURFACE_NEUTRAL;
    return {
      "--accent": accent,
      "--fg": fg,
      "--bg": bg,
      "--fg-muted": `color-mix(in oklab, ${fg} 62%, ${bg})`,
      "--bg-secondary": bg,
      "--bg-elevated": `color-mix(in oklab, ${bg} 96%, ${neutral})`,
      "--border-dark": `color-mix(in oklab, ${bg} 82%, ${neutral})`,
      "--border-light": `color-mix(in oklab, ${bg} 88%, ${neutral})`,
      "--border": `color-mix(in oklab, ${bg} 82%, ${neutral})`,
      "--accent-readable": `color-mix(in oklab, ${accent} 88%, ${fg})`,
      "--selection-bg": `color-mix(in oklab, ${accent} 82%, ${bg})`,
      "--selection-fg": `color-mix(in oklab, ${bg} 70%, ${fg})`,
      "--sidebar-control-hover-bg": `color-mix(in srgb, ${fg} 6%, ${bg})`,
      "--sidebar-control-active-hover-bg": `color-mix(in srgb, ${accent} 88%, ${bg})`,
      ...typography,
    };
  }

  const mix = themeSurfaceMix();
  const surfaceTone = themeSurfaceTone(fg, accent);
  const fgMutedTone = `color-mix(in oklab, ${fg} 68%, ${accent})`;
  return {
    "--accent": accent,
    "--fg": fg,
    "--bg": bg,
    "--fg-muted": `color-mix(in oklab, ${fgMutedTone} ${mix.fgMutedFgPct}%, ${bg})`,
    "--bg-secondary": `color-mix(in oklab, ${bg} ${mix.bgSecondaryBgPct}%, ${surfaceTone})`,
    "--bg-elevated": `color-mix(in oklab, ${bg} ${mix.bgElevatedBgPct}%, ${surfaceTone})`,
    "--border-dark": `color-mix(in oklab, ${bg} ${mix.borderDarkBgPct}%, ${surfaceTone})`,
    "--border-light": `color-mix(in oklab, ${bg} ${mix.borderLightBgPct}%, ${surfaceTone})`,
    "--border": `color-mix(in oklab, ${bg} ${mix.borderDarkBgPct}%, ${surfaceTone})`,
    "--accent-readable": `color-mix(in oklab, ${accent} ${mix.accentReadableAccentPct}%, ${fg})`,
    "--selection-bg": `color-mix(in oklab, ${accent} ${mix.selectionAccentPct}%, ${bg})`,
    "--selection-fg": `color-mix(in oklab, ${bg} 70%, ${fg})`,
    "--sidebar-control-hover-bg": `color-mix(in srgb, ${fg} ${mix.sidebarHoverFgPct}%, var(--bg-secondary))`,
    "--sidebar-control-active-hover-bg": `color-mix(in srgb, ${accent} ${mix.sidebarActiveAccentPct}%, var(--bg-secondary))`,
    ...typography,
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

/** Whether theme colors match a preset for highlighting (typography ignored). */
export function themeMatchesColorPreset(settings: ThemeSettings, colors: ThemeColors): boolean {
  const s = normalizeThemeSettings(settings);
  return (
    normalizeColorPickerValue(s.bg) === normalizeColorPickerValue(colors.bg) &&
    normalizeColorPickerValue(s.fg) === normalizeColorPickerValue(colors.fg) &&
    normalizeColorPickerValue(s.accent) === normalizeColorPickerValue(colors.accent)
  );
}

export type ThemePresetId = "dark" | "light";

/** Which built-in color theme best matches the current settings (for UI selection). */
export function matchThemePresetId(settings: ThemeSettings): ThemePresetId {
  const normalized = normalizeThemeSettings(settings);
  for (const preset of THEME_PRESETS) {
    if (themeMatchesColorPreset(normalized, preset.colors)) {
      return preset.id as ThemePresetId;
    }
  }
  return isLightThemeBackground(normalized.bg) ? "light" : "dark";
}

/** Coerce legacy green/blue preset colors to dark on load. */
export function migrateThemeToPreset(settings: ThemeSettings): ThemeSettings {
  const normalized = normalizeThemeSettings(settings);
  for (const preset of THEME_PRESETS) {
    if (themeMatchesColorPreset(normalized, preset.colors)) {
      return normalized;
    }
  }
  for (const legacy of LEGACY_REMOVED_PRESET_COLORS) {
    if (themeMatchesColorPreset(normalized, legacy)) {
      return applyThemeColors(normalized, findThemePreset("dark")!.colors);
    }
  }
  if (themeMatchesColorPreset(normalized, LEGACY_DEFAULT_DARK_COLORS)) {
    return applyThemeColors(normalized, findThemePreset("dark")!.colors);
  }
  if (themeMatchesColorPreset(normalized, LEGACY_DEFAULT_LIGHT_COLORS)) {
    return applyThemeColors(normalized, findThemePreset("light")!.colors);
  }
  if (themeMatchesColorPreset(normalized, LEGACY_GRAY_LIGHT_COLORS)) {
    return applyThemeColors(normalized, findThemePreset("light")!.colors);
  }
  return normalized;
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

/** Editor font ids (for update_theme.fontMono). Includes monospace and proportional options. */
export const FONT_MONO_IDS_FOR_SCHEMA: string[] = [...MONO_FONTS.map((f) => f.id)];

/** Theme preset ids (for apply_theme_preset). */
export const THEME_PRESET_IDS_FOR_SCHEMA: string[] = THEME_PRESETS.map((p) => p.id);
