import { describe, expect, it } from "vitest";
import {
  LIBRARY_PEEK_HIT_ZONE_PX,
  LIBRARY_PEEK_MAX,
  LIBRARY_PEEK_OVERSHOOT,
  LIBRARY_PEEK_ZONE_PX,
  computeLibraryPeekTarget,
  initialLibraryPeekSpring,
  libraryEdgeDistance,
  libraryPeekSpringSettled,
  peekFromDistance,
  stepLibraryPeekSpring,
} from "./libraryPeek";

describe("libraryEdgeDistance", () => {
  it("uses x for left sidebar", () => {
    expect(libraryEdgeDistance(40, 1000, "left")).toBe(40);
    expect(libraryEdgeDistance(-5, 1000, "left")).toBe(0);
  });

  it("uses width - x for right sidebar", () => {
    expect(libraryEdgeDistance(960, 1000, "right")).toBe(40);
    expect(libraryEdgeDistance(1100, 1000, "right")).toBe(0);
  });
});

describe("peekFromDistance", () => {
  it("is 0 outside the zone and LIBRARY_PEEK_MAX at the edge", () => {
    expect(peekFromDistance(LIBRARY_PEEK_ZONE_PX)).toBe(0);
    expect(peekFromDistance(LIBRARY_PEEK_ZONE_PX + 50)).toBe(0);
    expect(peekFromDistance(0)).toBe(LIBRARY_PEEK_MAX);
    expect(peekFromDistance(-10)).toBe(LIBRARY_PEEK_MAX);
  });

  it("rises smoothly inside the zone and stays below full open", () => {
    const mid = peekFromDistance(LIBRARY_PEEK_ZONE_PX / 2);
    const near = peekFromDistance(LIBRARY_PEEK_ZONE_PX / 4);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(LIBRARY_PEEK_MAX);
    expect(near).toBeGreaterThan(mid);
    expect(near).toBeLessThanOrEqual(LIBRARY_PEEK_MAX);
  });
});

describe("computeLibraryPeekTarget", () => {
  it("peeks gradually as cursor nears the left edge", () => {
    const far = computeLibraryPeekTarget({
      x: LIBRARY_PEEK_ZONE_PX + 80,
      viewportWidth: 1000,
      side: "left",
    });
    expect(far.target).toBe(0);
    expect(far.latch).toBe(false);

    const midX = LIBRARY_PEEK_ZONE_PX / 2;
    const mid = computeLibraryPeekTarget({
      x: midX,
      viewportWidth: 1000,
      side: "left",
    });
    expect(mid.target).toBe(peekFromDistance(midX));
    expect(mid.latch).toBe(false);
  });

  it("latches inside the hit zone", () => {
    const result = computeLibraryPeekTarget({
      x: LIBRARY_PEEK_HIT_ZONE_PX,
      viewportWidth: 1000,
      side: "left",
    });
    expect(result.latch).toBe(true);
    expect(result.target).toBe(1);
  });

  it("does not latch just outside the hit zone", () => {
    const x = LIBRARY_PEEK_HIT_ZONE_PX + 1;
    const result = computeLibraryPeekTarget({
      x,
      viewportWidth: 1000,
      side: "left",
    });
    expect(result.latch).toBe(false);
    expect(result.target).toBe(peekFromDistance(x));
  });

  it("mirrors for right sidebar", () => {
    const result = computeLibraryPeekTarget({
      x: 1000 - LIBRARY_PEEK_HIT_ZONE_PX,
      viewportWidth: 1000,
      side: "right",
    });
    expect(result.latch).toBe(true);
    expect(result.target).toBe(1);
  });
});

describe("stepLibraryPeekSpring", () => {
  it("overshoots the target when approaching from below", () => {
    let spring = initialLibraryPeekSpring(0);
    const target = 0.4;
    let maxValue = 0;
    for (let i = 0; i < 90; i++) {
      spring = stepLibraryPeekSpring(spring, target, 1 / 60);
      maxValue = Math.max(maxValue, spring.value);
    }
    expect(maxValue).toBeGreaterThan(target);
    expect(maxValue).toBeLessThanOrEqual(LIBRARY_PEEK_MAX + LIBRARY_PEEK_OVERSHOOT + 0.001);
  });

  it("settles near the target", () => {
    let spring = initialLibraryPeekSpring(0);
    const target = 0.35;
    for (let i = 0; i < 240; i++) {
      spring = stepLibraryPeekSpring(spring, target, 1 / 60);
    }
    expect(libraryPeekSpringSettled(spring, target)).toBe(true);
    expect(spring.value).toBeCloseTo(target, 2);
  });
});
