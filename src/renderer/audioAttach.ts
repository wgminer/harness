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

export function isAudioAttachFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  // Some browsers leave MIME empty for m4a/caf/etc.
  const name = file.name.toLowerCase();
  return AUDIO_FILE_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** First audio file in a drop/pick list, or null. */
export function pickAudioAttachFile(files: FileList | File[] | null | undefined): File | null {
  if (!files || files.length === 0) return null;
  for (const file of Array.from(files)) {
    if (isAudioAttachFile(file)) return file;
  }
  return null;
}
