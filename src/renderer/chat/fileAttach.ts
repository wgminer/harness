/**
 * Non-audio composer attachments. Text-like files are read in the renderer and
 * staged as named text blocks (same wire format as large pastes); anything that
 * is not valid UTF-8 text is rejected.
 */

export const MAX_TEXT_ATTACH_BYTES = 512 * 1024;

/** File contents as text, or null when the file is too large or not UTF-8 text. */
export async function readTextAttachment(file: File): Promise<string | null> {
  if (file.size > MAX_TEXT_ATTACH_BYTES) return null;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}

/** Upper-cased extension for card labels, e.g. "MD"; empty when there is none. */
export function fileExtensionLabel(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toUpperCase();
}

export function attachRejectedMessage(names: readonly string[]): string {
  const what = names.length === 1 ? names[0] : `${names.length} files`;
  return `Couldn't attach ${what}. Text and audio files work for now.`;
}
