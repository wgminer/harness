const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** e.g. `just now`, `5 min ago`, `3 h ago`, `yesterday`, `4 days ago`, `Oct 3`. */
export function formatRelativeTime(ms: number, now: number = Date.now()): string {
  const delta = Math.max(0, now - ms);
  if (delta < MINUTE_MS) return "just now";
  if (delta < HOUR_MS) return `${Math.floor(delta / MINUTE_MS)} min ago`;
  if (delta < DAY_MS) return `${Math.floor(delta / HOUR_MS)} h ago`;
  if (delta < 2 * DAY_MS) return "yesterday";
  if (delta < 7 * DAY_MS) return `${Math.floor(delta / DAY_MS)} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Total recorded audio, e.g. `0 min`, `45 min`, `3 h 12 min`. */
export function formatAudioDuration(ms: number): string {
  const totalMinutes = Math.round(Math.max(0, ms) / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  if (minutes === 0) return `${hours} h`;
  return `${hours} h ${minutes} min`;
}
