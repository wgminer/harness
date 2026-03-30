/**
 * Theme font stacks (Google Fonts loaded in main.tsx) and helpers to read/write custom theme CSS.
 */

export const FONT_SIZE_OPTIONS = [12, 13, 14, 15, 16, 18] as const;

/** Single stylesheet URL for every web font used below (Latin subset default). */
export const GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?" +
  [
    "family=Inter:wght@400;500;600;700",
    "family=Open+Sans:wght@400;600;700",
    "family=Roboto:wght@400;500;700",
    "family=Lato:wght@400;700",
    "family=Nunito:wght@400;600;700",
    "family=Work+Sans:wght@400;600;700",
    "family=Source+Sans+3:wght@400;600;700",
    "family=Plus+Jakarta+Sans:wght@400;600;700",
    "family=Merriweather:wght@400;700",
    "family=Lora:wght@400;600;700",
    "family=Literata:wght@400;600;700",
    "family=JetBrains+Mono:wght@400;500;600",
    "family=Fira+Code:wght@400;500;600",
    "family=Source+Code+Pro:wght@400;600",
    "family=IBM+Plex+Mono:wght@400;600",
    "family=Roboto+Mono:wght@400;600",
    "family=Space+Mono:wght@400;700",
  ].join("&") +
  "&display=swap";

export const BODY_FONT_OPTIONS = [
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
] as const;

export const MONO_FONT_OPTIONS = [
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

export type BodyFontId = (typeof BODY_FONT_OPTIONS)[number]["id"];
export type MonoFontId = (typeof MONO_FONT_OPTIONS)[number]["id"];
export type HeadingFontChoice = "same_body" | "same_mono" | BodyFontId;

export const BODY_FONT_STACKS = Object.fromEntries(BODY_FONT_OPTIONS.map((o) => [o.id, o.stack])) as Record<
  BodyFontId,
  string
>;

export const MONO_FONT_STACKS = Object.fromEntries(MONO_FONT_OPTIONS.map((o) => [o.id, o.stack])) as Record<
  MonoFontId,
  string
>;

export type ThemeFormState = {
  accent: string;
  bodyFont: BodyFontId;
  monoFont: MonoFontId;
  headingFont: HeadingFontChoice;
  fontSize: (typeof FONT_SIZE_OPTIONS)[number];
};

export const THEME_FORM_DEFAULT: ThemeFormState = {
  accent: "#f2ff00",
  bodyFont: "system",
  monoFont: "sf",
  headingFont: "same_mono",
  fontSize: 14,
};

function normalizeStack(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function parseCssVar(css: string, name: string): string | undefined {
  const prefix = `--${name}:`;
  const i = css.indexOf(prefix);
  if (i === -1) return undefined;
  const rest = css.slice(i + prefix.length).trimStart();
  const semi = rest.indexOf(";");
  if (semi === -1) return undefined;
  return rest.slice(0, semi).trim();
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

function stackToMapKey<T extends Record<string, string>>(
  map: T,
  stack: string | undefined,
  fallback: keyof T
): keyof T {
  if (!stack) return fallback;
  const n = normalizeStack(stack);
  for (const [k, v] of Object.entries(map) as [keyof T, string][]) {
    if (normalizeStack(v) === n) return k;
  }
  return fallback;
}

function parseFontSizePx(raw: string | undefined): (typeof FONT_SIZE_OPTIONS)[number] | null {
  if (!raw) return null;
  const m = raw.trim().match(/^([\d.]+)px$/i);
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  if (!Number.isFinite(n)) return null;
  return FONT_SIZE_OPTIONS.includes(n as (typeof FONT_SIZE_OPTIONS)[number])
    ? (n as (typeof FONT_SIZE_OPTIONS)[number])
    : null;
}

export function headingToCssValue(id: HeadingFontChoice): string {
  if (id === "same_body") return "var(--font-family)";
  if (id === "same_mono") return "var(--font-mono)";
  return BODY_FONT_STACKS[id];
}

export function parseHeadingFontChoice(css: string): HeadingFontChoice | null {
  const v = parseCssVar(css, "font-heading");
  if (!v) return null;
  if (/var\s*\(\s*--font-family\s*\)/i.test(v)) return "same_body";
  if (/var\s*\(\s*--font-mono\s*\)/i.test(v)) return "same_mono";
  const n = normalizeStack(v);
  for (const [k, stack] of Object.entries(BODY_FONT_STACKS) as [BodyFontId, string][]) {
    if (normalizeStack(stack) === n) return k;
  }
  return null;
}

export function buildThemeCss(form: ThemeFormState): string {
  return `:root {
  --accent: ${form.accent.trim()};
  --font-family: ${BODY_FONT_STACKS[form.bodyFont]};
  --font-mono: ${MONO_FONT_STACKS[form.monoFont]};
  --font-heading: ${headingToCssValue(form.headingFont)};
  --font-size: ${form.fontSize}px;
}`;
}

export function themeFromStoredCss(css: string): ThemeFormState {
  const next = { ...THEME_FORM_DEFAULT };
  if (!css.trim()) return next;
  const accent = parseHexAccent(parseCssVar(css, "accent"));
  if (accent) next.accent = accent;
  const body = parseCssVar(css, "font-family");
  next.bodyFont = stackToMapKey(BODY_FONT_STACKS, body, "system");
  const mono = parseCssVar(css, "font-mono");
  next.monoFont = stackToMapKey(MONO_FONT_STACKS, mono, "sf");
  const heading = parseHeadingFontChoice(css);
  if (heading) next.headingFont = heading;
  const size = parseFontSizePx(parseCssVar(css, "font-size"));
  if (size != null) next.fontSize = size;
  return next;
}
