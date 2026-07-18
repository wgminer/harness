import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCENT_PRESETS,
  DEFAULT_ACCENT,
  isValidAccentHex,
  normalizeAccentHex,
} from "./accent";

const root = join(__dirname, "../..");

describe("accent", () => {
  it("normalizes 3- and 6-digit hex; rejects invalid", () => {
    expect(normalizeAccentHex("#5B9CF5")).toBe("#5b9cf5");
    expect(normalizeAccentHex("#abc")).toBe("#aabbcc");
    expect(normalizeAccentHex("  #2bb5a0  ")).toBe("#2bb5a0");
    expect(normalizeAccentHex("not-a-color")).toBe(DEFAULT_ACCENT);
    expect(normalizeAccentHex(null)).toBe(DEFAULT_ACCENT);
    expect(isValidAccentHex("#5b9cf5")).toBe(true);
    expect(isValidAccentHex("#fff")).toBe(true);
    expect(isValidAccentHex("5b9cf5")).toBe(false);
  });

  it("keeps presets as valid hex including the default", () => {
    expect(ACCENT_PRESETS.some((p) => p.hex === DEFAULT_ACCENT)).toBe(true);
    for (const preset of ACCENT_PRESETS) {
      expect(isValidAccentHex(preset.hex)).toBe(true);
      expect(normalizeAccentHex(preset.hex)).toBe(preset.hex.toLowerCase());
    }
  });

  it("matches --accent in base.css and site/styles.css", () => {
    const exact = new RegExp(`--accent:\\s*${DEFAULT_ACCENT}`, "i");
    const base = readFileSync(join(root, "src/renderer/base.css"), "utf8");
    const site = readFileSync(join(root, "site/styles.css"), "utf8");
    expect(base).toMatch(exact);
    expect(site).toMatch(exact);
  });
});
