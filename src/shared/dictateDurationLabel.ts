/** Quiet compose-corner label for summed dictation audio. Hours only at ≥1h. */
export function formatDictateDurationLabel(durationMs: number): string {
  const ms = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 0;
  const totalMinutes = Math.floor(ms / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}
