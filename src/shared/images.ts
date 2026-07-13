export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageBackground = "auto" | "opaque" | "transparent";
export type ImageOutputFormat = "png" | "jpeg" | "webp";

/** API `size` string: `"auto"` or `"WIDTHxHEIGHT"`. */
export type ImageSize = string;

export interface GeneratedImage {
  id: string;
  title: string;
  prompt: string;
  createdAt: number;
  updatedAt: number;
  /** OpenAI size: `auto` or `WIDTHxHEIGHT`. */
  size: ImageSize;
  quality: ImageQuality;
  background: ImageBackground;
  outputFormat: ImageOutputFormat;
  /** Absolute filesystem path when a file exists; null before first generate. */
  absolutePath: string | null;
  hasFile: boolean;
}

export interface ImageGenerateInput {
  imageId: string;
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
  background: ImageBackground;
  outputFormat: ImageOutputFormat;
}

const UNTITLED_IMAGE_TITLE = "Untitled image";

/** Truncate a prompt into a sidebar/list title. */
export function titleFromImagePrompt(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  if (!trimmed) return UNTITLED_IMAGE_TITLE;
  if (trimmed.length <= 60) return trimmed;
  return `${trimmed.slice(0, 60).trimEnd()}…`;
}

export function getDisplayImageTitle(title: string | null | undefined): string {
  const cleaned = (title ?? "").trim();
  return cleaned.length > 0 ? cleaned : UNTITLED_IMAGE_TITLE;
}
