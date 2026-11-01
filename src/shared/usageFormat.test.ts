import { describe, expect, it } from "vitest";
import { formatAudioDuration, formatRelativeTime } from "./usageFormat";

describe("formatRelativeTime", () => {
  const now = Date.UTC(2026, 10, 1, 12, 0, 0);

  it("reads recent times in minutes and hours", () => {
    expect(formatRelativeTime(now - 20_000, now)).toBe("just now");
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe("5 min ago");
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago");
  });

  it("reads days, then falls back to a date", () => {
    expect(formatRelativeTime(now - 30 * 3_600_000, now)).toBe("yesterday");
    expect(formatRelativeTime(now - 4 * 86_400_000, now)).toBe("4 days ago");
    expect(formatRelativeTime(now - 30 * 86_400_000, now)).not.toMatch(/ago/);
  });

  it("treats future timestamps as now", () => {
    expect(formatRelativeTime(now + 60_000, now)).toBe("just now");
  });
});

describe("formatAudioDuration", () => {
  it("shows minutes under an hour", () => {
    expect(formatAudioDuration(0)).toBe("0 min");
    expect(formatAudioDuration(45 * 60_000)).toBe("45 min");
  });

  it("shows hours and minutes", () => {
    expect(formatAudioDuration(3 * 3_600_000)).toBe("3 h");
    expect(formatAudioDuration(3 * 3_600_000 + 12 * 60_000)).toBe("3 h 12 min");
  });
});
