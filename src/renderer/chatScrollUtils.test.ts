import { describe, expect, it } from "vitest";
import { seedTailPaddingPx, trimTailPaddingPx } from "./chatScrollUtils";

describe("seedTailPaddingPx", () => {
  it("adds composer height and chat viewport height", () => {
    expect(seedTailPaddingPx(80, 700)).toBe(780);
    expect(seedTailPaddingPx(0, 500)).toBe(500);
  });

  it("clamps to a safe range", () => {
    expect(seedTailPaddingPx(1, 1)).toBe(120);
  });
});

describe("trimTailPaddingPx", () => {
  it("subtracts assistant growth from seed pad and floors at zero", () => {
    expect(
      trimTailPaddingPx({
        seedPadPx: 800,
        assistantBaselinePx: 40,
        assistantCurrentHeightPx: 240,
      })
    ).toBe(600);

    expect(
      trimTailPaddingPx({
        seedPadPx: 500,
        assistantBaselinePx: 10,
        assistantCurrentHeightPx: 600,
      })
    ).toBe(0);
  });

  it("does not increase padding when assistant height dips (layout flicker)", () => {
    expect(
      trimTailPaddingPx({
        seedPadPx: 400,
        assistantBaselinePx: 200,
        assistantCurrentHeightPx: 180,
      })
    ).toBe(400);
  });
});
