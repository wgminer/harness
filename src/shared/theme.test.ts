import { describe, expect, it } from "vitest";
import {
  applyThemeColors,
  coerceFontSizePx,
  DEFAULT_THEME_SETTINGS,
  enforceVeryLowContrastGuard,
  FONT_SIZE_OPTIONS,
  normalizeThemeSettings,
  stepFontSize,
  themeMatchesColorPreset,
  themeSettingsToCss,
  THEME_PRESETS,
} from "./theme";

describe("normalizeThemeSettings", () => {
  it("fills new fields for legacy theme JSON", () => {
    const t = normalizeThemeSettings({ accent: "#ffffff", font: "inter", fontSize: 14 });
    expect(t.accent).toBe("#ffffff");
    expect(t.font).toBe("inter");
    expect(t.fontMono).toBe(DEFAULT_THEME_SETTINGS.fontMono);
    expect(t.fontSize).toBe(14);
    expect(t.fg).toBe(DEFAULT_THEME_SETTINGS.fg);
    expect(t.bg).toBe(DEFAULT_THEME_SETTINGS.bg);
  });

  it("ignores legacy sidebarHighlight when migrating old theme.json", () => {
    const t = normalizeThemeSettings({
      accent: "#f2ff00",
      sidebarHighlight: "#334155",
      font: "inter",
      fontSize: 14,
    });
    expect(t.accent).toBe("#f2ff00");
    expect(t).not.toHaveProperty("sidebarHighlight");
  });

  it("moves mono-only legacy font to fontMono and restores UI font", () => {
    const t = normalizeThemeSettings({ accent: "#f2ff00", font: "jetbrains", fontSize: 14 });
    expect(t.fontMono).toBe("jetbrains");
    expect(t.font).toBe(DEFAULT_THEME_SETTINGS.font);
  });

  it("accepts explicit fontMono with UI font", () => {
    const t = normalizeThemeSettings({
      accent: "#f2ff00",
      font: "lato",
      fontMono: "fira_code",
      fontSize: 15,
      fg: "#f0f6fc",
      bg: "#161b22",
    });
    expect(t.font).toBe("lato");
    expect(t.fontMono).toBe("fira_code");
    expect(t.fg).toBe("#f0f6fc");
    expect(t.bg).toBe("#161b22");
  });
});

describe("THEME_PRESETS", () => {
  it("exposes exactly five curated color palettes", () => {
    expect(THEME_PRESETS).toHaveLength(5);
    expect(THEME_PRESETS.map((p) => p.id)).toEqual(["night", "paper", "matcha", "ik_blue", "bloomberg"]);
  });

  it("keeps bloomberg off absolute black so hover layers remain visible", () => {
    const bloomberg = THEME_PRESETS.find((p) => p.id === "bloomberg");
    expect(bloomberg).toBeDefined();
    expect(bloomberg?.colors.bg).not.toBe("#000000");
  });
});

describe("applyThemeColors", () => {
  it("updates colors without changing typography", () => {
    const base: typeof DEFAULT_THEME_SETTINGS = {
      ...DEFAULT_THEME_SETTINGS,
      font: "lora",
      fontMono: "fira_code",
      fontSize: 16,
    };
    const paper = THEME_PRESETS.find((p) => p.id === "paper")!.colors;
    const next = applyThemeColors(base, paper);
    expect(next.fg).toBe(paper.fg);
    expect(next.bg).toBe(paper.bg);
    expect(next.accent).toBe(paper.accent);
    expect(next.font).toBe("lora");
    expect(next.fontMono).toBe("fira_code");
    expect(next.fontSize).toBe(16);
  });
});

describe("themeMatchesColorPreset", () => {
  it("matches colors only and ignores typography", () => {
    const paper = THEME_PRESETS.find((p) => p.id === "paper")!.colors;
    const withDifferentFonts = {
      ...applyThemeColors(DEFAULT_THEME_SETTINGS, paper),
      font: "lora" as const,
      fontMono: "space_mono" as const,
      fontSize: 18 as const,
    };
    expect(themeMatchesColorPreset(withDifferentFonts, paper)).toBe(true);
    expect(themeMatchesColorPreset(DEFAULT_THEME_SETTINGS, paper)).toBe(false);
  });
});

describe("font size stepping", () => {
  it("steps through allowed sizes and clamps at ends", () => {
    expect(stepFontSize(14, -1)).toBe(13);
    expect(stepFontSize(14, 1)).toBe(15);
    expect(stepFontSize(FONT_SIZE_OPTIONS[0], -1)).toBe(FONT_SIZE_OPTIONS[0]);
    expect(stepFontSize(FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1], 1)).toBe(
      FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1],
    );
  });

  it("coerces arbitrary px values to the nearest allowed size", () => {
    expect(coerceFontSizePx(14)).toBe(14);
    expect(coerceFontSizePx(17)).toBe(16);
    expect(coerceFontSizePx(11)).toBe(12);
  });
});

describe("themeSettingsToCss", () => {
  it("emits user and derived custom properties", () => {
    const css = themeSettingsToCss(DEFAULT_THEME_SETTINGS);
    expect(css).toContain("--accent:");
    expect(css).not.toContain("--sidebar-highlight:");
    expect(css).toContain("--fg:");
    expect(css).toContain("--bg:");
    expect(css).toContain("--fg-muted:");
    expect(css).toContain("--bg-secondary:");
    expect(css).toContain("--bg-elevated:");
    expect(css).toContain("--border-dark:");
    expect(css).toContain("--border-light:");
    expect(css).toContain("--border:");
    // Borders must sit above surface steps (more fg than bg-secondary / bg-elevated).
    expect(css).toMatch(/--bg-secondary: color-mix\(in oklab, #0d1117 92%, #e6edf3\)/);
    expect(css).toMatch(/--bg-elevated: color-mix\(in oklab, #0d1117 84%, #e6edf3\)/);
    expect(css).toMatch(/--border-light: color-mix\(in oklab, #0d1117 82%, #e6edf3\)/);
    expect(css).toMatch(/--border-dark: color-mix\(in oklab, #0d1117 68%, #e6edf3\)/);
    expect(css).toContain("--accent-readable:");
    expect(css).toContain("--selection-bg:");
    expect(css).toContain("--sidebar-control-hover-bg:");
    expect(css).toContain("--sidebar-control-active-hover-bg:");
    expect(css).toMatch(/sidebar-control-active-hover-bg:[^;]*color-mix\(in srgb, #f2ff00 72%/);
    expect(css).toContain("--font-family:");
    expect(css).toContain("--font-family-mono:");
    expect(css).toContain("--font-size:");
  });
});

describe("enforceVeryLowContrastGuard", () => {
  it("does not change colors when contrast is remotely readable", () => {
    const c = enforceVeryLowContrastGuard({ fg: "#333333", bg: "#ffffff" }, "fg");
    expect(c).toEqual({ fg: "#333333", bg: "#ffffff" });
  });

  it("nudges bg when fg is changed into an unreadable range", () => {
    const c = enforceVeryLowContrastGuard({ fg: "#ffffff", bg: "#fffffe" }, "fg");
    expect(c.fg).toBe("#ffffff");
    expect(c.bg).not.toBe("#fffffe");
  });

  it("nudges fg when bg is changed into an unreadable range", () => {
    const c = enforceVeryLowContrastGuard({ fg: "#111111", bg: "#101010" }, "bg");
    expect(c.bg).toBe("#101010");
    expect(c.fg).not.toBe("#111111");
  });
});
