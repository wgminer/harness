import { normalizeAppearanceTheme, type AppearanceTheme } from "./types";

/**
 * World Clock hour palette, applied as a tinted Harness shell.
 *
 * Palette matches world-clock `HOUR_COLORS` (see that project's COLOR-BY-TIME.md).
 * Experiment difference: colors interpolate across the hour instead of stepping
 * at :00, then mix into the existing dark chrome tokens so chat stays readable.
 *
 * Preview any hour with `?tod=14.5` (fractional hours wrap 0–24).
 * Enabled from System → General when appearance theme is `time`.
 */

/** Exact 24 hexes from world-clock ClockCard — one per local hour. */
export const WORLD_CLOCK_HOUR_COLORS = [
  "#1a237e", // 0  midnight
  "#1a237e", // 1  early night
  "#1a237e", // 2  deep night
  "#1a237e", // 3  late night
  "#283593", // 4  pre-dawn
  "#3949ab", // 5  dawn
  "#5c6bc0", // 6  early morning
  "#7986cb", // 7  morning
  "#9fa8da", // 8  late morning
  "#c5cae9", // 9  mid-morning
  "#e8eaf6", // 10 late morning
  "#fff9c4", // 11 pre-noon
  "#ffeb3b", // 12 noon
  "#fff176", // 13 early afternoon
  "#ffd54f", // 14 afternoon
  "#ffc107", // 15 mid-afternoon
  "#ffb300", // 16 late afternoon
  "#ff9800", // 17 early evening
  "#ff6f00", // 18 evening
  "#ff5722", // 19 late evening
  "#e64a19", // 20 dusk
  "#bf360c", // 21 night
  "#8d1f0f", // 22 deep night
  "#1a237e", // 23 midnight
] as const;

export const WORLD_CLOCK_HOUR_PHASES = [
  "midnight",
  "early night",
  "deep night",
  "late night",
  "pre-dawn",
  "dawn",
  "early morning",
  "morning",
  "late morning",
  "mid-morning",
  "late morning",
  "pre-noon",
  "noon",
  "early afternoon",
  "afternoon",
  "mid-afternoon",
  "late afternoon",
  "early evening",
  "evening",
  "late evening",
  "dusk",
  "night",
  "deep night",
  "midnight",
] as const;

/**
 * Hardcoded chrome in `base.css` that does not derive from `--bg` / `--accent`.
 * Scale is relative to the adaptive sky mix (1 = same as the page shell).
 */
export const SHELL_TINT_TOKENS = [
  { name: "--bg", hex: "#111111", scale: 1 },
  { name: "--bg-secondary", hex: "#222222", scale: 0.48 },
  { name: "--bg-elevated", hex: "#222222", scale: 0.48 },
  { name: "--border-edge", hex: "#222222", scale: 0.48 },
  { name: "--border-input", hex: "#333333", scale: 0.4 },
  { name: "--border-light", hex: "#777777", scale: 0.22 },
  { name: "--btn-bg", hex: "#2e3033", scale: 0.38 },
  { name: "--btn-bg-hover", hex: "#3b3d40", scale: 0.32 },
  { name: "--overlay-subtle", hex: "#1f2124", scale: 0.42 },
  { name: "--overlay", hex: "#2a2c2f", scale: 0.38 },
  { name: "--overlay-strong", hex: "#393b3e", scale: 0.32 },
  { name: "--hover-bg", hex: "#26282b", scale: 0.38 },
  { name: "--hover-bg-strong", hex: "#323437", scale: 0.32 },
  { name: "--scrollbar-track", hex: "#26282b", scale: 0.38 },
  { name: "--scrollbar-thumb", hex: "#6a6c6f", scale: 0.22 },
] as const;

export const SHELL_BG = SHELL_TINT_TOKENS[0].hex;
export const SHELL_SECONDARY = SHELL_TINT_TOKENS[1].hex;

/** Night skies can take more mix; noon/morning are clamped so `--fg` stays readable. */
export const SKY_MIX_BG_DARK = 0.52;
export const SKY_MIX_BG_LIGHT = 0.28;
/** Secondary surfaces take about half the shell mix. */
export const SKY_MIX_SECONDARY_SCALE = SHELL_TINT_TOKENS[1].scale;

export const TOD_QUERY_PARAM = "tod";
export const TOD_PREVIEW_STORAGE_KEY = "harness.tod-preview.v1";

export const TIME_OF_DAY_ZONES = [
  { id: "UTC", label: "UTC" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/Denver", label: "Denver" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Sao_Paulo", label: "São Paulo" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Africa/Lagos", label: "Lagos" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Kolkata", label: "Kolkata" },
  { id: "Asia/Shanghai", label: "Shanghai" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Sydney", label: "Sydney" },
] as const;

export const TIME_OF_DAY_ZONE_IDS = new Set<string>(TIME_OF_DAY_ZONES.map((zone) => zone.id));

export type Rgb = { r: number; g: number; b: number };

export type TimeOfDayPreview = {
  /** Pinned fractional hour 0–24. Null follows the clock (`?tod=` still wins). */
  hour: number | null;
  /** IANA zone used when hour is not pinned and `?tod=` is absent. */
  timeZone: string | null;
  /** Multiplier on the adaptive sky mix. 1 = default; 0 = untinted chrome. */
  tintScale: number;
};

export const DEFAULT_TIME_OF_DAY_PREVIEW: TimeOfDayPreview = {
  hour: null,
  timeZone: null,
  tintScale: 1,
};

export type TimeOfDayShellColors = {
  sky: string;
  bg: string;
  bgSecondary: string;
  tokens: Record<(typeof SHELL_TINT_TOKENS)[number]["name"], string>;
};

type StyleTarget = {
  style: {
    setProperty: (name: string, value: string) => void;
    removeProperty: (name: string) => void;
  };
  dataset: {
    appearance?: string;
    todHour?: string;
    todZone?: string;
    todTint?: string;
  };
};

/** Private token used so Time theme does not fight `:root { --bg: #111 }` + `@property`. */
export function todVarName(token: string): string {
  return `--tod-${token.startsWith("--") ? token.slice(2) : token}`;
}

type PreviewStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const previewListeners = new Set<(preview: TimeOfDayPreview) => void>();
let previewState: TimeOfDayPreview = readStoredPreview();
let timeThemeActive = false;

export function parseHex(hex: string): Rgb {
  const digits = hex.replace("#", "");
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: Rgb): string {
  const clampChannel = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clampChannel(r), clampChannel(g), clampChannel(b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Linear RGB mix: `t = 0` keeps `from`, `t = 1` is `to`. */
export function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  return toHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

export function clampTintScale(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.max(0, Math.min(1.5, scale));
}

/** ITU-R BT.601 luma, same formula world-clock uses for text contrast. */
export function skyBrightness(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export function skyMixForBackground(sky: string): number {
  const t = skyBrightness(sky) / 255;
  return SKY_MIX_BG_DARK + (SKY_MIX_BG_LIGHT - SKY_MIX_BG_DARK) * t;
}

export function localHourFraction(date: Date): number {
  return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
}

export function hourInTimeZone(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    }).formatToParts(date);
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? 0);
    return wrapHour(read("hour") + read("minute") / 60 + read("second") / 3600);
  } catch {
    return localHourFraction(date);
  }
}

export function hourPhaseLabel(hour: number): string {
  return WORLD_CLOCK_HOUR_PHASES[Math.floor(wrapHour(hour)) % 24];
}

export function formatHourClock(hour: number): string {
  const wrapped = wrapHour(hour);
  const h = Math.floor(wrapped);
  const m = Math.min(59, Math.round((wrapped - h) * 60));
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Discrete world-clock lookup (no interpolation). */
export function hourColorAt(hour: number): string {
  return WORLD_CLOCK_HOUR_COLORS[Math.floor(wrapHour(hour)) % 24];
}

/** Blend current hour color into the next, by fraction of the hour. */
export function interpolateHourColor(hour: number): string {
  const wrapped = wrapHour(hour);
  const index = Math.floor(wrapped);
  const t = wrapped - index;
  const from = WORLD_CLOCK_HOUR_COLORS[index];
  const to = WORLD_CLOCK_HOUR_COLORS[(index + 1) % 24];
  return mixHex(from, to, t);
}

export function shellColorsForHour(
  hour: number,
  tintScale: number = 1,
): TimeOfDayShellColors {
  const sky = interpolateHourColor(hour);
  const mix = Math.max(0, Math.min(1, skyMixForBackground(sky) * clampTintScale(tintScale)));
  const tokens = {} as TimeOfDayShellColors["tokens"];
  for (const token of SHELL_TINT_TOKENS) {
    tokens[token.name] = mixHex(token.hex, sky, mix * token.scale);
  }
  return {
    sky,
    bg: tokens["--bg"],
    bgSecondary: tokens["--bg-secondary"],
    tokens,
  };
}

export function parseTimeOfDayPreview(raw: string | null): TimeOfDayPreview {
  if (!raw) return { ...DEFAULT_TIME_OF_DAY_PREVIEW };
  try {
    const parsed = JSON.parse(raw) as Partial<TimeOfDayPreview>;
    return normalizePreview(parsed);
  } catch {
    return { ...DEFAULT_TIME_OF_DAY_PREVIEW };
  }
}

export function normalizePreview(partial: Partial<TimeOfDayPreview>): TimeOfDayPreview {
  const hour =
    typeof partial.hour === "number" && Number.isFinite(partial.hour) ? wrapHour(partial.hour) : null;
  const timeZone =
    typeof partial.timeZone === "string" && TIME_OF_DAY_ZONE_IDS.has(partial.timeZone)
      ? partial.timeZone
      : null;
  return {
    hour,
    timeZone,
    tintScale: clampTintScale(typeof partial.tintScale === "number" ? partial.tintScale : 1),
  };
}

function previewStorage(): PreviewStorage | null {
  try {
    if (typeof globalThis.localStorage === "undefined") return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStoredPreview(): TimeOfDayPreview {
  return parseTimeOfDayPreview(previewStorage()?.getItem(TOD_PREVIEW_STORAGE_KEY) ?? null);
}

function writeStoredPreview(next: TimeOfDayPreview): void {
  const storage = previewStorage();
  if (!storage) return;
  try {
    storage.setItem(TOD_PREVIEW_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Quota / private mode — ignore.
  }
}

export function getTimeOfDayPreview(): TimeOfDayPreview {
  return previewState;
}

export function subscribeTimeOfDayPreview(
  listener: (preview: TimeOfDayPreview) => void,
): () => void {
  previewListeners.add(listener);
  return () => {
    previewListeners.delete(listener);
  };
}

export function setTimeOfDayPreview(
  patch: Partial<TimeOfDayPreview>,
  options?: { persist?: boolean; apply?: boolean },
): TimeOfDayPreview {
  previewState = normalizePreview({ ...previewState, ...patch });
  if (options?.persist !== false) writeStoredPreview(previewState);
  for (const listener of previewListeners) listener(previewState);
  if (options?.apply !== false && timeThemeActive) applyTimeOfDayBackground();
  return previewState;
}

export function resetTimeOfDayPreview(options?: { persist?: boolean; apply?: boolean }): TimeOfDayPreview {
  previewState = { ...DEFAULT_TIME_OF_DAY_PREVIEW };
  if (options?.persist !== false) writeStoredPreview(previewState);
  for (const listener of previewListeners) listener(previewState);
  if (options?.apply !== false && timeThemeActive) applyTimeOfDayBackground();
  return previewState;
}

/**
 * Priority: debugger pin → `?tod=` → selected zone clock → local clock.
 */
export function resolveHour(
  now: Date,
  search: string,
  preview: TimeOfDayPreview = getTimeOfDayPreview(),
): number {
  if (preview.hour != null) return wrapHour(preview.hour);
  const raw = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
    TOD_QUERY_PARAM,
  );
  if (raw != null && raw !== "") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return wrapHour(parsed);
  }
  if (preview.timeZone) return hourInTimeZone(now, preview.timeZone);
  return localHourFraction(now);
}

export function applyTimeOfDayBackground(
  now: Date = new Date(),
  root: StyleTarget | null = typeof document !== "undefined" ? document.documentElement : null,
  search: string = typeof window !== "undefined" ? window.location.search : "",
  preview: TimeOfDayPreview = getTimeOfDayPreview(),
): TimeOfDayShellColors {
  const hour = resolveHour(now, search, preview);
  const colors = shellColorsForHour(hour, preview.tintScale);
  if (root) {
    root.dataset.appearance = "time";
    root.style.setProperty("--time-sky", colors.sky);
    root.style.setProperty(todVarName("--time-sky"), colors.sky);
    for (const token of SHELL_TINT_TOKENS) {
      root.style.setProperty(token.name, colors.tokens[token.name]);
      root.style.setProperty(todVarName(token.name), colors.tokens[token.name]);
    }
    root.dataset.todHour = String(Math.floor(hour));
    root.dataset.todZone = preview.timeZone ?? "local";
    root.dataset.todTint = String(preview.tintScale);
  }
  return colors;
}

export function isTimeThemeActive(): boolean {
  return timeThemeActive;
}

/** Restore CSS defaults for the inventoried chrome tokens. */
export function clearTimeOfDayBackground(
  root: StyleTarget | null = typeof document !== "undefined" ? document.documentElement : null,
): void {
  timeThemeActive = false;
  if (!root) return;
  root.dataset.appearance = "dark";
  root.style.removeProperty("--time-sky");
  root.style.removeProperty(todVarName("--time-sky"));
  for (const token of SHELL_TINT_TOKENS) {
    root.style.removeProperty(token.name);
    root.style.removeProperty(todVarName(token.name));
  }
  delete root.dataset.todHour;
  delete root.dataset.todZone;
  delete root.dataset.todTint;
}

/** Apply or clear the time tint from the System appearance theme. */
export function applyAppearanceTheme(
  theme: AppearanceTheme,
  now: Date = new Date(),
  root: StyleTarget | null = typeof document !== "undefined" ? document.documentElement : null,
  search: string = typeof window !== "undefined" ? window.location.search : "",
): void {
  if (normalizeAppearanceTheme(theme) === "time") {
    timeThemeActive = true;
    // Follow the clock (and `?tod=`), not leftover debugger pin/mix in localStorage.
    applyTimeOfDayBackground(now, root, search, DEFAULT_TIME_OF_DAY_PREVIEW);
    return;
  }
  clearTimeOfDayBackground(root);
}
