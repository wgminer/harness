import { describe, expect, it } from "vitest";
import { themeColorsChanged } from "./themeTransition";

describe("themeColorsChanged", () => {
  const colors = { bg: "#0b0d10", fg: "#eceef2", accent: "#5b9cf5" };

  it("is false when only typography changes", () => {
    expect(
      themeColorsChanged(colors, { ...colors, font: "inter" as const, fontMono: "sf" as const, fontSize: 16 }),
    ).toBe(false);
  });

  it("is true when a palette color changes", () => {
    expect(themeColorsChanged(colors, { ...colors, bg: "#f6f7f9" })).toBe(true);
  });
});
