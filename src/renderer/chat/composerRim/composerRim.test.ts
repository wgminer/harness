import { describe, expect, it } from "vitest";
import { DEFAULT_COMPOSER_RIM, composerRimVars, parseComposerRimSettings } from "./composerRim";

describe("parseComposerRimSettings", () => {
  it("falls back to defaults for missing or broken input", () => {
    expect(parseComposerRimSettings(null)).toEqual(DEFAULT_COMPOSER_RIM);
    expect(parseComposerRimSettings("{nope")).toEqual(DEFAULT_COMPOSER_RIM);
  });

  it("rejects unknown enums and clamps numbers into range", () => {
    const parsed = parseComposerRimSettings(
      JSON.stringify({ pattern: "plaid", when: "focus", color: "neon", width: 99, hue: "red", pulseFloor: -1 }),
    );
    expect(parsed.pattern).toBe(DEFAULT_COMPOSER_RIM.pattern);
    expect(parsed.when).toBe("focus");
    expect(parsed.color).toBe(DEFAULT_COMPOSER_RIM.color);
    expect(parsed.width).toBe(6);
    expect(parsed.hue).toBe(DEFAULT_COMPOSER_RIM.hue);
    expect(parsed.pulseFloor).toBe(0);
  });
});

describe("composerRimVars", () => {
  it("pauses animations and flattens the pulse when durations are 0", () => {
    const vars = composerRimVars({ ...DEFAULT_COMPOSER_RIM, spinSeconds: 0, pulseSeconds: 0 });
    expect(vars["--rim-spin-state"]).toBe("paused");
    expect(vars["--rim-pulse-state"]).toBe("paused");
    expect(vars["--rim-pulse-floor"]).toBe("1");
  });
});
