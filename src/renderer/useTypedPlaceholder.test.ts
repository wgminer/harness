import { describe, expect, it } from "vitest";

/**
 * Pure helper mirroring the type-out slice used by useTypedPlaceholder —
 * kept so the animation contract stays explicit in tests.
 */
function typedSlice(target: string, charIndex: number): string {
  return target.slice(0, Math.max(0, Math.min(charIndex, target.length)));
}

describe("typedPlaceholder slice", () => {
  it("starts empty and grows to the full string", () => {
    const target = "Name a decision…";
    expect(typedSlice(target, 0)).toBe("");
    expect(typedSlice(target, 4)).toBe("Name");
    expect(typedSlice(target, target.length)).toBe(target);
  });

  it("clamps past the end", () => {
    expect(typedSlice("hi", 99)).toBe("hi");
  });
});
