/** Shared accept string for `<input type="file">` and drop validation. */
export const AUDIO_FILE_ACCEPT =
  "audio/*,.m4a,.mp4,.mpeg4,.aac,.mp3,.wav,.caf,.aif,.aiff";

const AUDIO_FILE_EXTENSIONS = [
  ".m4a",
  ".mp4",
  ".mpeg4",
  ".aac",
  ".mp3",
  ".wav",
  ".caf",
  ".aif",
  ".aiff",
  ".ogg",
  ".flac",
  ".webm",
] as const;

const AUDIO_MIME_BY_EXT: Record<string, string> = {
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".mpeg4": "audio/mp4",
  ".aac": "audio/aac",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".caf": "audio/x-caf",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
};

function fileNameFromPath(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

export function audioMimeForName(name: string): string {
  const lower = name.toLowerCase();
  for (const [ext, mime] of Object.entries(AUDIO_MIME_BY_EXT)) {
    if (lower.endsWith(ext)) return mime;
  }
  return "application/octet-stream";
}

export function isAudioAttachFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return AUDIO_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isAudioAttachPath(path: string): boolean {
  return isAudioAttachFileName(fileNameFromPath(path));
}

export function isAudioAttachFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  // Some browsers leave MIME empty for m4a/caf/etc.
  return isAudioAttachFileName(file.name);
}

/** First audio file in a drop/pick list, or null. */
export function pickAudioAttachFile(files: FileList | File[] | null | undefined): File | null {
  if (!files || files.length === 0) return null;
  for (const file of Array.from(files)) {
    if (isAudioAttachFile(file)) return file;
  }
  return null;
}

/** First audio path from a Tauri OS file-drop list, or null. */
export function pickAudioAttachPath(paths: string[] | null | undefined): string | null {
  if (!paths || paths.length === 0) return null;
  for (const path of paths) {
    if (isAudioAttachPath(path)) return path;
  }
  return null;
}

/** Load a staged/local audio path into a browser File for the existing attach flow. */
export async function fileFromAudioPath(path: string, name?: string): Promise<File> {
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const fileName = name || fileNameFromPath(path);
  const res = await fetch(convertFileSrc(path));
  if (!res.ok) {
    throw new Error("Unable to read dropped audio.");
  }
  const blob = await res.blob();
  return new File([blob], fileName, {
    type: blob.type || audioMimeForName(fileName),
  });
}
