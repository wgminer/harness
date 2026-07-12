export const STICKY_WINDOW_LABEL_PREFIX = "sticky-";

export function isStickyWindowLabel(label: string): boolean {
  return label.startsWith(STICKY_WINDOW_LABEL_PREFIX);
}

export function noteIdFromStickyWindowLabel(label: string): string | null {
  if (!isStickyWindowLabel(label)) return null;
  const noteId = label.slice(STICKY_WINDOW_LABEL_PREFIX.length);
  return noteId.length > 0 ? noteId : null;
}

export async function getCurrentWindowLabel(): Promise<string | null> {
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    return getCurrentWebviewWindow().label;
  } catch {
    return null;
  }
}

export async function isCurrentStickyWindow(): Promise<boolean> {
  const label = await getCurrentWindowLabel();
  return label != null && isStickyWindowLabel(label);
}
