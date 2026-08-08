import { describe, expect, it } from "vitest";
import {
  LIBRARY_DOCK_TRAVEL_PX,
  LIBRARY_PEEK_MAX,
  LIBRARY_PEEK_MAX_PX,
  LIBRARY_PEEK_OVERSHOOT,
  LIBRARY_PEEK_ZONE_PX,
  computeLibraryPeekTarget,
  initialLibraryPeekSpring,
  isPointerMovingTowardLibrary,
  libraryEdgeDistance,
  libraryPeekMaxFraction,
  libraryPeekSpringSettled,
  peekFromDistance,
  stepLibraryPeekSpring,
  updateLibraryPeekTowardIntent,
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

describe("isPointerMovingTowardLibrary", () => {
  it("requires leftward motion for a left sidebar", () => {
    expect(isPointerMovingTowardLibrary(-4, "left")).toBe(true);
    expect(isPointerMovingTowardLibrary(4, "left")).toBe(false);
    expect(isPointerMovingTowardLibrary(0, "left")).toBe(false);
  });

  it("requires rightward motion for a right sidebar", () => {
    expect(isPointerMovingTowardLibrary(4, "right")).toBe(true);
    expect(isPointerMovingTowardLibrary(-4, "right")).toBe(false);
  });
});

describe("updateLibraryPeekTowardIntent", () => {
  it("clears intent outside the peek zone", () => {
    expect(
      updateLibraryPeekTowardIntent({
        distance: LIBRARY_PEEK_ZONE_PX + 1,
        deltaX: -10,
        side: "left",
        previousToward: true,
      }),
    ).toBe(false);
  });

  it("keeps previous intent for tiny jitter inside the zone", () => {
    expect(
      updateLibraryPeekTowardIntent({
        distance: 40,
        deltaX: 0.1,
        side: "left",
        previousToward: true,
      }),
    ).toBe(true);
  });

  it("updates from meaningful motion inside the zone", () => {
    expect(
      updateLibraryPeekTowardIntent({
        distance: 40,
        deltaX: -3,
        side: "left",
        previousToward: false,
      }),
    ).toBe(true);
    expect(
      updateLibraryPeekTowardIntent({
        distance: 40,
        deltaX: 3,
        side: "left",
        previousToward: true,
      }),
    ).toBe(false);
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

  it("respects custom peekMax", () => {
    expect(peekFromDistance(0, LIBRARY_PEEK_ZONE_PX, 0.5)).toBe(0.5);
  });
});

describe("libraryPeekMaxFraction", () => {
  it("maps peek px onto dock travel", () => {
    expect(libraryPeekMaxFraction(0)).toBe(0);
    expect(libraryPeekMaxFraction(LIBRARY_DOCK_TRAVEL_PX)).toBe(1);
    expect(libraryPeekMaxFraction(LIBRARY_PEEK_MAX_PX)).toBeCloseTo(LIBRARY_PEEK_MAX, 2);
  });
});

describe("computeLibraryPeekTarget", () => {
  it("peeks gradually as cursor nears the left edge", () => {
    expect(
      computeLibraryPeekTarget({
        x: LIBRARY_PEEK_ZONE_PX + 80,
        viewportWidth: 1000,
        side: "left",
      }),
    ).toBe(0);

    const midX = LIBRARY_PEEK_ZONE_PX / 2;
    expect(
      computeLibraryPeekTarget({
        x: midX,
        viewportWidth: 1000,
        side: "left",
      }),
    ).toBe(peekFromDistance(midX));
  });

  it("peeks up to peekMax at the edge without latching", () => {
    expect(
      computeLibraryPeekTarget({
        x: 0,
        viewportWidth: 1000,
        side: "left",
      }),
    ).toBe(LIBRARY_PEEK_MAX);
  });

  it("mirrors for right sidebar", () => {
    expect(
      computeLibraryPeekTarget({
        x: 1000,
        viewportWidth: 1000,
        side: "right",
      }),
    ).toBe(LIBRARY_PEEK_MAX);
  });

  it("suppresses peek when not moving toward the edge", () => {
    expect(
      computeLibraryPeekTarget({
        x: 0,
        viewportWidth: 1000,
        side: "left",
        movingToward: false,
      }),
    ).toBe(0);
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

  it("uses custom stiffness / damping when provided", () => {
    let soft = initialLibraryPeekSpring(0);
    let stiff = initialLibraryPeekSpring(0);
    const target = 0.5;
    soft = stepLibraryPeekSpring(soft, target, 1 / 60, { stiffness: 80, damping: 20 });
    stiff = stepLibraryPeekSpring(stiff, target, 1 / 60, { stiffness: 700, damping: 20 });
    expect(stiff.value).toBeGreaterThan(soft.value);
  });
});
