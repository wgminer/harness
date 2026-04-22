import { describe, expect, it } from "vitest";
import { isPathAllowed } from "./fileTools";

describe("isPathAllowed", () => {
  const roots = ["/Users/test/home", "/Users/test/desktop", "/Users/test/app"];

  it("allows exact roots and nested children", () => {
    expect(isPathAllowed("/Users/test/home", roots)).toBe(true);
    expect(isPathAllowed("/Users/test/home/projects/a.txt", roots)).toBe(true);
  });

  it("rejects sibling prefix collisions", () => {
    expect(isPathAllowed("/Users/test/homework/notes.txt", roots)).toBe(false);
    expect(isPathAllowed("/Users/test/desktopx", roots)).toBe(false);
  });

  it("rejects traversal outside allowed roots", () => {
    expect(isPathAllowed("/tmp/../etc/passwd", roots)).toBe(false);
  });
});
