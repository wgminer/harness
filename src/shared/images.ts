export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageBackground = "auto" | "opaque" | "transparent";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageOperation = "new" | "adjust";
export type ImageVersionKind = "generate" | "edit";

/** API `size` string: `"auto"` or `"WIDTHxHEIGHT"`. */
export type ImageSize = string;

export interface ImageVersion {
  id: string;
  parentId: string | null;
  /** Letter branch label: `"A"`, `"B"`, … */
  branch: string;
  /** 1-based index along that letter (`A1`, `A2`, `B1`). */
  indexInBranch: number;
  fileName: string;
  prompt: string;
  kind: ImageVersionKind;
  size: ImageSize;
  quality: ImageQuality;
  background: ImageBackground;
  outputFormat: ImageOutputFormat;
  createdAt: number;
}

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
  versions: ImageVersion[];
  activeVersionId: string;
}

export interface ImageGenerateInput {
  /** Omit / null on first generate to create a new library entry. */
  imageId?: string | null;
  /** `"new"` text-to-image (create only) or `"adjust"` (ignored when imageId set — always adjust). */
  operation?: ImageOperation;
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

export function imageVersionLabel(version: Pick<ImageVersion, "branch" | "indexInBranch">): string {
  return `${version.branch}${version.indexInBranch}`;
}

/** Children of a version node (direct only). */
export function imageVersionChildren(
  versions: ImageVersion[],
  parentId: string | null,
): ImageVersion[] {
  return versions
    .filter((v) => (v.parentId ?? null) === parentId)
    .sort((a, b) => {
      if (a.branch !== b.branch) return a.branch.localeCompare(b.branch);
      return a.indexInBranch - b.indexInBranch;
    });
}
