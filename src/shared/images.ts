export type ImageQuality = "auto" | "low" | "medium" | "high";
export type ImageBackground = "auto" | "opaque" | "transparent";
export type ImageOutputFormat = "png" | "jpeg" | "webp";
export type ImageOperation = "new" | "adjust" | "finalize";
export type ImageVersionKind = "generate" | "edit" | "finalize";

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
  /** Tombstoned version ids — must not reappear after sync merge. */
  deletedVersionIds?: string[];
}

/** Creates a library entry immediately (no file yet) so the sidebar can show progress. */
export interface ImageCreateInput {
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
  background: ImageBackground;
  outputFormat: ImageOutputFormat;
}

export interface ImageGenerateInput {
  /** Omit / null to create a new library entry on generate; prefer `create` then generate with id. */
  imageId?: string | null;
  /** `"new"` text-to-image (create only), `"adjust"` edit, or `"finalize"` last pass. */
  operation?: ImageOperation;
  prompt: string;
  size: ImageSize;
  quality: ImageQuality;
  background: ImageBackground;
  outputFormat: ImageOutputFormat;
  /**
   * Extra reference/annotation images as data URLs (`data:image/...;base64,...`).
   * Marker edits: `[annotatedCanvas, sourceImage]` before the model call.
   */
  extraImageDataUrls?: string[];
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

/** Internal branch label (`A1`, `B2`) — fork tree metadata, not UI display. */
export function imageVersionLabel(version: Pick<ImageVersion, "branch" | "indexInBranch">): string {
  return `${version.branch}${version.indexInBranch}`;
}

/** Sort key for time-ordered version lists (matches sync merge). */
export function compareImageVersions(a: ImageVersion, b: ImageVersion): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id.localeCompare(b.id);
}

/** Versions in creation order (`createdAt`, then `id`). */
export function orderedImageVersions(
  image: Pick<GeneratedImage, "versions">,
): ImageVersion[] {
  return [...image.versions].sort(compareImageVersions);
}

/** 1-based display index per version id (`v1` → 1). */
export function versionDisplayIndexMap(
  image: Pick<GeneratedImage, "versions">,
): Map<string, number> {
  const map = new Map<string, number>();
  orderedImageVersions(image).forEach((version, index) => {
    map.set(version.id, index + 1);
  });
  return map;
}

export function versionDisplayIndex(
  image: Pick<GeneratedImage, "versions">,
  versionId: string,
): number | undefined {
  return versionDisplayIndexMap(image).get(versionId);
}

/** Sequential UI label (`v1`, `v2`, …) from creation order. */
export function displayVersionLabel(
  image: Pick<GeneratedImage, "versions">,
  versionId: string,
): string {
  const index = versionDisplayIndex(image, versionId);
  return index !== undefined ? `v${index}` : "v?";
}

export function imageVersionById(
  image: Pick<GeneratedImage, "versions">,
  versionId: string,
): ImageVersion | undefined {
  return image.versions.find((v) => v.id === versionId);
}

export function parentVersionId(
  image: Pick<GeneratedImage, "versions">,
  versionId: string,
): string | null {
  const version = imageVersionById(image, versionId);
  return version?.parentId ?? null;
}

/** True when no other version lists this id as `parentId`. */
export function isLeafVersion(
  image: Pick<GeneratedImage, "versions">,
  versionId: string,
): boolean {
  return !image.versions.some((v) => v.parentId === versionId);
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
