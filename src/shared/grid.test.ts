import { describe, expect, it } from "vitest";
import { GRID, lineHeightForFont, snapToGrid, space } from "./grid";

describe("grid", () => {
  it("GRID is 4", () => {
    expect(GRID).toBe(4);
  });

  it("snapToGrid rounds to nearest multiple of 4", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(1)).toBe(0);
    expect(snapToGrid(2)).toBe(4);
    expect(snapToGrid(137)).toBe(136);
    expect(snapToGrid(138)).toBe(140);
  });

  it("lineHeightForFont snaps to grid and never goes below font size", () => {
    expect(lineHeightForFont(14)).toBe(20);
    expect(lineHeightForFont(14, 21)).toBe(20);
    expect(lineHeightForFont(14, 22)).toBe(24);
    expect(lineHeightForFont(12, 16)).toBe(16);
  });
});
