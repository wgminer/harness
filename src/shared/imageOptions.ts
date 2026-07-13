import type {
  ImageBackground,
  ImageOutputFormat,
  ImageQuality,
  ImageSize,
} from "./images";

export const IMAGE_DEFAULTS = {
  size: "auto" as ImageSize,
  quality: "auto" as ImageQuality,
  background: "auto" as ImageBackground,
  outputFormat: "png" as ImageOutputFormat,
  /** Defaults used when switching into custom size mode. */
  customWidth: 1024,
  customHeight: 1024,
};

/** Standard GPT Image sizes (supported by gpt-image-1 and later). */
export const IMAGE_SIZE_PRESETS: { value: ImageSize; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "1024x1024", label: "1024×1024" },
  { value: "1536x1024", label: "1536×1024" },
  { value: "1024x1536", label: "1024×1536" },
];

export const IMAGE_SIZE_PRESET_VALUES = new Set(IMAGE_SIZE_PRESETS.map((p) => p.value));

/** Map legacy aspect presets (pre-size field) to size strings. */
export const LEGACY_ASPECT_TO_SIZE: Record<string, ImageSize> = {
  auto: "auto",
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

export const IMAGE_QUALITY_OPTIONS: { value: ImageQuality; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export const IMAGE_BACKGROUND_OPTIONS: { value: ImageBackground; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "opaque", label: "Opaque" },
  { value: "transparent", label: "Transparent" },
];

export const IMAGE_OUTPUT_FORMAT_OPTIONS: { value: ImageOutputFormat; label: string }[] = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];
