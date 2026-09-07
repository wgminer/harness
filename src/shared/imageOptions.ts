import type {
  ImageBackground,
  ImageOutputFormat,
  ImageQuality,
  ImageSize,
} from "./images";

/** User-facing quality mode — maps to API quality only. */
export type ImageRenderMode = "draft" | "final";

export type ImageShape = "square" | "landscape" | "portrait" | "custom";

export const IMAGE_QUALITY_BY_MODE: Record<ImageRenderMode, ImageQuality> = {
  draft: "low",
  final: "high",
};

/** @deprecated Prefer IMAGE_QUALITY_BY_MODE; kept for tests that reference presets. */
export const IMAGE_MODE_PRESETS: Record<
  ImageRenderMode,
  {
    quality: ImageQuality;
    outputFormat: ImageOutputFormat;
    background: ImageBackground;
  }
> = {
  draft: {
    quality: IMAGE_QUALITY_BY_MODE.draft,
    outputFormat: "png",
    background: "opaque",
  },
  final: {
    quality: IMAGE_QUALITY_BY_MODE.final,
    outputFormat: "png",
    background: "opaque",
  },
};

export const IMAGE_DEFAULTS = {
  size: "1024x1024" as ImageSize,
  shape: "square" as ImageShape,
  mode: "draft" as ImageRenderMode,
  quality: IMAGE_QUALITY_BY_MODE.draft,
  background: "opaque" as ImageBackground,
  outputFormat: "png" as ImageOutputFormat,
};

/** Aspect presets shown in the canvas (Square / Landscape / Portrait). */
export const IMAGE_ASPECT_OPTIONS: { value: ImageSize; label: string; shape: ImageShape }[] = [
  { value: "1024x1024", label: "Square", shape: "square" },
  { value: "1536x1024", label: "Landscape", shape: "landscape" },
  { value: "1024x1536", label: "Portrait", shape: "portrait" },
];

export const IMAGE_SHAPE_OPTIONS: { value: ImageShape; label: string; size?: ImageSize }[] = [
  { value: "square", label: "Square", size: "1024x1024" },
  { value: "landscape", label: "Landscape", size: "1536x1024" },
  { value: "portrait", label: "Portrait", size: "1024x1536" },
  { value: "custom", label: "Custom" },
];

export const IMAGE_ASPECT_VALUES = new Set(IMAGE_ASPECT_OPTIONS.map((p) => p.value));

export const IMAGE_RENDER_MODE_OPTIONS: {
  value: ImageRenderMode;
  label: string;
}[] = [
  { value: "draft", label: "Draft" },
  { value: "final", label: "Final" },
];

export const IMAGE_OUTPUT_FORMAT_OPTIONS: { value: ImageOutputFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

export const IMAGE_BACKGROUND_OPTIONS: { value: ImageBackground; label: string }[] = [
  { value: "opaque", label: "Opaque" },
  { value: "transparent", label: "Transparent" },
];

/** Standard GPT Image sizes still accepted by the API (including auto). */
export const IMAGE_SIZE_PRESETS: { value: ImageSize; label: string }[] = [
  { value: "auto", label: "Auto" },
  ...IMAGE_ASPECT_OPTIONS.map(({ value, label }) => ({ value, label })),
];

export const IMAGE_SIZE_PRESET_VALUES = new Set(IMAGE_SIZE_PRESETS.map((p) => p.value));

/** Map legacy aspect presets (pre-size field) to size strings. */
export const LEGACY_ASPECT_TO_SIZE: Record<string, ImageSize> = {
  auto: "1024x1024",
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
};

export function sizeFromLegacyAspect(aspect: string | null | undefined): ImageSize {
  if (!aspect) return IMAGE_DEFAULTS.size;
  return LEGACY_ASPECT_TO_SIZE[aspect] ?? IMAGE_DEFAULTS.size;
}

const SIZE_RE = /^(\d+)x(\d+)$/i;

export function parseImageSize(size: string): { width: number; height: number } | null {
  const trimmed = size.trim();
  if (!trimmed || trimmed === "auto") return null;
  const m = trimmed.match(SIZE_RE);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    return null;
  }
  return { width, height };
}

export function formatImageSize(width: number, height: number): ImageSize {
  return `${Math.round(width)}x${Math.round(height)}`;
}

export function isImageSizePreset(size: string): boolean {
  return IMAGE_SIZE_PRESET_VALUES.has(size.trim());
}

export function isImageAspectPreset(size: string): boolean {
  return IMAGE_ASPECT_VALUES.has(size.trim());
}

export function shapeFromSize(size: string | null | undefined): ImageShape {
  if (!size) return IMAGE_DEFAULTS.shape;
  const trimmed = size.trim();
  const match = IMAGE_ASPECT_OPTIONS.find((o) => o.value === trimmed);
  if (match) return match.shape;
  if (trimmed === "auto") return "square";
  const fromLegacy = LEGACY_ASPECT_TO_SIZE[trimmed];
  if (fromLegacy) {
    return IMAGE_ASPECT_OPTIONS.find((o) => o.value === fromLegacy)?.shape ?? "square";
  }
  return "custom";
}

export function sizeForShape(shape: ImageShape, fallbackCustom: ImageSize = "1280x720"): ImageSize {
  if (shape === "custom") return fallbackCustom;
  return IMAGE_SHAPE_OPTIONS.find((o) => o.value === shape)?.size ?? IMAGE_DEFAULTS.size;
}

/**
 * Snap a stored size (including auto / custom) to Square / Landscape / Portrait.
 */
export function aspectPresetFromSize(size: string | null | undefined): ImageSize {
  if (!size) return IMAGE_DEFAULTS.size;
  const trimmed = size.trim();
  if (isImageAspectPreset(trimmed)) return trimmed;
  const fromLegacy = LEGACY_ASPECT_TO_SIZE[trimmed];
  if (fromLegacy) return fromLegacy;

  const parsed = parseImageSize(trimmed);
  if (!parsed) return IMAGE_DEFAULTS.size;
  const ratio = parsed.width / parsed.height;
  if (ratio > 1.15) return "1536x1024";
  if (ratio < 0.87) return "1024x1536";
  return "1024x1024";
}

/** Infer Draft vs Final from last-saved generation settings. */
export function imageRenderModeFromSettings(
  quality: string | null | undefined,
): ImageRenderMode {
  if (quality === "high") return "final";
  return "draft";
}

export function settingsForRenderMode(mode: ImageRenderMode): {
  quality: ImageQuality;
  outputFormat: ImageOutputFormat;
  background: ImageBackground;
} {
  return {
    quality: IMAGE_QUALITY_BY_MODE[mode],
    outputFormat: IMAGE_DEFAULTS.outputFormat,
    background: IMAGE_DEFAULTS.background,
  };
}

export function qualityForRenderMode(mode: ImageRenderMode): ImageQuality {
  return IMAGE_QUALITY_BY_MODE[mode];
}

/**
 * Validate a size for the Images API.
 * Presets (`auto` / standard WxH) always pass.
 * Custom sizes follow gpt-image-2 constraints (multiples of 16, max edge, ratio, pixel bounds).
 */
export function validateImageSize(size: string): string | null {
  const trimmed = size.trim();
  if (!trimmed) return "Size is required.";
  if (trimmed === "auto" || isImageSizePreset(trimmed)) return null;

  const parsed = parseImageSize(trimmed);
  if (!parsed) return "Size must be auto or WIDTHxHEIGHT (e.g. 1280x720).";

  const { width, height } = parsed;
  if (width % 16 !== 0 || height % 16 !== 0) {
    return "Width and height must be multiples of 16.";
  }
  if (width > 3840 || height > 3840) {
    return "Each edge must be at most 3840px.";
  }
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long / short > 3) {
    return "Aspect ratio must be at most 3:1.";
  }
  const pixels = width * height;
  if (pixels < 655_360) {
    return "Total pixels must be at least 655,360 (e.g. 1024×640).";
  }
  if (pixels > 8_294_400) {
    return "Total pixels must be at most 8,294,400.";
  }
  return null;
}

/** JPEG cannot be transparent — callers should force opaque or switch format. */
export function backgroundAllowedForFormat(
  format: ImageOutputFormat,
  background: ImageBackground,
): ImageBackground {
  if (format === "jpeg" && background === "transparent") return "opaque";
  return background;
}
