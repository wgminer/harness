/** Prefix on model-facing message bodies; not stored on disk. */
const SENT_AT_LINE = /^\[sent_at=[^\]]+\]\n/;

function resolveTimeZone(timeZone?: string): string {
  const tz = (timeZone ?? "").trim();
  if (tz) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
      return tz;
    } catch {
      // fall through
    }
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Human-readable "now" for the system prompt (local timezone). */
export function formatCurrentDateTimeForPrompt(now: Date = new Date(), timeZone?: string): string {
  const tz = resolveTimeZone(timeZone);
  return new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);
}

export function formatTemporalContextBlock(now: Date = new Date(), timeZone?: string): string {
  const tz = resolveTimeZone(timeZone);
  const formatted = formatCurrentDateTimeForPrompt(now, tz);
  return [
    "[TEMPORAL_CONTEXT]",
    `Current local date and time (${tz}): ${formatted}`,
    "When present, a message begins with [sent_at=...] (ISO 8601 UTC) for when it was sent.",
    "Use sent_at together with the current time above to interpret relative dates and whether discussed future plans, events, or deadlines have already passed.",
  ].join("\n");
}

/** Annotate message text for the model only; leaves stored content unchanged. */
export function annotateMessageContentForModel(content: string, timestampMs?: number): string {
  if (timestampMs == null || !Number.isFinite(timestampMs)) return content;
  if (SENT_AT_LINE.test(content)) return content;
  const sentAt = new Date(timestampMs).toISOString();
  return `[sent_at=${sentAt}]\n${content}`;
}

export function stripSentAtPrefix(content: string): string {
  return content.replace(SENT_AT_LINE, "");
}
