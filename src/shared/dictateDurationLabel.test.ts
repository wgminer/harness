import { describe, expect, it } from "vitest";
import { formatDictateDurationLabel } from "./dictateDurationLabel";

describe("formatDictateDurationLabel", () => {
  it("shows minutes only under one hour", () => {
    expect(formatDictateDurationLabel(0)).toBe("0m");
    expect(formatDictateDurationLabel(59_999)).toBe("0m");
    expect(formatDictateDurationLabel(60_000)).toBe("1m");
    expect(formatDictateDurationLabel(59 * 60_000)).toBe("59m");
  });

  it("includes hours at one hour and above", () => {
    expect(formatDictateDurationLabel(60 * 60_000)).toBe("1h");
    expect(formatDictateDurationLabel(61 * 60_000)).toBe("1h 1m");
    expect(formatDictateDurationLabel((3 * 60 + 12) * 60_000)).toBe("3h 12m");
  });
});
