import { describe, expect, it } from "vitest";
import { formatMediumTimestamp } from "./formatMediumTimestamp";

describe("formatMediumTimestamp", () => {
  it("formats a finite timestamp", () => {
    const out = formatMediumTimestamp(Date.UTC(2024, 0, 15, 12, 30));
    expect(out.length).toBeGreaterThan(0);
    expect(out).not.toBe("Invalid Date");
  });

  it("returns a string for NaN without throwing", () => {
    expect(() => formatMediumTimestamp(Number.NaN)).not.toThrow();
    expect(typeof formatMediumTimestamp(Number.NaN)).toBe("string");
  });
});
