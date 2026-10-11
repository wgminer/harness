type TimedMessage = { role: string; timestamp?: number };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact elapsed time: "8s", "4m 12s", "2h 5m", "3 days". */
export function formatElapsed(ms: number): string {
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / SECOND))}s`;
  if (ms < HOUR) {
    const m = Math.floor(ms / MINUTE);
    const s = Math.round((ms % MINUTE) / SECOND);
    return s > 0 && s < 60 ? `${m}m ${s}s` : `${m}m`;
  }
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MINUTE);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(ms / DAY);
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * The second reading of a message's time, shown when hovering the clock time:
 * how long a reply took, or how long after the previous message this one was sent.
 * Falls back to the full date when there is nothing to measure against.
 */
export function formatMessageTimeDetail(message: TimedMessage, previous?: TimedMessage): string {
  const ts = message.timestamp;
  if (ts == null) return "";
  const prevTs = previous?.timestamp;
  if (prevTs == null || ts < prevTs) {
    return new Date(ts).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }
  const gap = ts - prevTs;
  if (message.role === "assistant" && previous?.role === "user") {
    return `Replied in ${formatElapsed(gap)}`;
  }
  if (gap < SECOND) return "Sent with the previous message";
  return `${formatElapsed(gap)} after the previous message`;
}
