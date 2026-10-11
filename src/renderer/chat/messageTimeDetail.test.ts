import { describe, expect, it } from "vitest";
import { formatElapsed, formatMessageTimeDetail } from "./messageTimeDetail";

describe("formatElapsed", () => {
  it("scales units with the gap", () => {
    expect(formatElapsed(400)).toBe("1s");
    expect(formatElapsed(8_200)).toBe("8s");
    expect(formatElapsed(252_000)).toBe("4m 12s");
    expect(formatElapsed(240_000)).toBe("4m");
    expect(formatElapsed(7_500_000)).toBe("2h 5m");
    expect(formatElapsed(3 * 86_400_000)).toBe("3 days");
  });
});

describe("formatMessageTimeDetail", () => {
  const t0 = Date.UTC(2026, 9, 9, 12, 0, 0);

  it("reports how long a reply took after the user message", () => {
    expect(
      formatMessageTimeDetail({ role: "assistant", timestamp: t0 + 8_000 }, { role: "user", timestamp: t0 }),
    ).toBe("Replied in 8s");
  });

  it("reports the gap since the previous message for user turns", () => {
    expect(
      formatMessageTimeDetail({ role: "user", timestamp: t0 + 252_000 }, { role: "assistant", timestamp: t0 }),
    ).toBe("4m 12s after the previous message");
    expect(
      formatMessageTimeDetail({ role: "user", timestamp: t0 + 1 }, { role: "user", timestamp: t0 }),
    ).toBe("Sent with the previous message");
  });

  it("falls back to the date for the first message", () => {
    expect(formatMessageTimeDetail({ role: "user", timestamp: t0 })).toMatch(/2026/);
    expect(formatMessageTimeDetail({ role: "user" })).toBe("");
  });
});
