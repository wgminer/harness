import { describe, expect, it } from "vitest";
import { snapToGrid } from "./grid";

describe("grid", () => {
  it("snapToGrid rounds to nearest multiple of 4", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(1)).toBe(0);
    expect(snapToGrid(2)).toBe(4);
    expect(snapToGrid(137)).toBe(136);
    expect(snapToGrid(138)).toBe(140);
  });
});
