/** Locale medium date + short time (e.g. note/chat detail stamps). Empty string if invalid. */
export function formatMediumTimestamp(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return "";
  }
}
