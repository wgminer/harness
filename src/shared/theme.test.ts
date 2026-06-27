import { describe, expect, it } from "vitest";
import {
  applyThemeColors,
  coerceFontSizePx,
  DEFAULT_THEME_SETTINGS,
  enforceVeryLowContrastGuard,
  findThemePreset,
  FONT_SIZE_OPTIONS,
  normalizeThemeSettings,
  resolveThemePresetId,
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
      accent: "#d4ff00",
      sidebarHighlight: "#334155",
      font: "inter",
      fontSize: 14,
    });
    expect(t.accent).toBe("#d4ff00");
    expect(t).not.toHaveProperty("sidebarHighlight");
  });

  it("moves mono-only legacy font to fontMono and restores UI font", () => {
    const t = normalizeThemeSettings({ accent: "#d4ff00", font: "jetbrains", fontSize: 14 });
    expect(t.fontMono).toBe("jetbrains");
    expect(t.font).toBe(DEFAULT_THEME_SETTINGS.font);
  });

  it("accepts explicit fontMono with UI font", () => {
    const t = normalizeThemeSettings({
      accent: "#d4ff00",
      font: "lato",
      fontMono: "fira_code",
      fontSize: 16,
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
  it("exposes four built-in themes", () => {
    expect(THEME_PRESETS).toHaveLength(4);
    expect(THEME_PRESETS.map((p) => p.id)).toEqual(["dark", "light", "green", "blue"]);
  });

  it("resolves legacy preset aliases", () => {
    expect(resolveThemePresetId("night")).toBe("dark");
    expect(resolveThemePresetId("paper")).toBe("light");
    expect(resolveThemePresetId("matcha")).toBe("green");
    expect(resolveThemePresetId("ik_blue")).toBe("blue");
    expect(findThemePreset("bloomberg")?.id).toBe("dark");
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
    const light = THEME_PRESETS.find((p) => p.id === "light")!.colors;
    const next = applyThemeColors(base, light);
    expect(next.fg).toBe(light.fg);
    expect(next.bg).toBe(light.bg);
    expect(next.accent).toBe(light.accent);
    expect(next.font).toBe("lora");
    expect(next.fontMono).toBe("fira_code");
    expect(next.fontSize).toBe(16);
  });
});

describe("themeMatchesColorPreset", () => {
  it("matches colors only and ignores typography", () => {
    const light = THEME_PRESETS.find((p) => p.id === "light")!.colors;
    const withDifferentFonts = {
      ...applyThemeColors(DEFAULT_THEME_SETTINGS, light),
      font: "lora" as const,
      fontMono: "space_mono" as const,
      fontSize: 16 as const,
    };
    expect(themeMatchesColorPreset(withDifferentFonts, light)).toBe(true);
    expect(themeMatchesColorPreset(DEFAULT_THEME_SETTINGS, light)).toBe(false);
  });
});

describe("font size stepping", () => {
  it("steps through allowed sizes and clamps at ends", () => {
    expect(stepFontSize(14, -1)).toBe(12);
    expect(stepFontSize(14, 1)).toBe(16);
    expect(stepFontSize(FONT_SIZE_OPTIONS[0], -1)).toBe(FONT_SIZE_OPTIONS[0]);
    expect(stepFontSize(FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1], 1)).toBe(
      FONT_SIZE_OPTIONS[FONT_SIZE_OPTIONS.length - 1],
    );
  });

  it("coerces arbitrary px values to the nearest allowed size", () => {
    expect(coerceFontSizePx(14)).toBe(14);
    expect(coerceFontSizePx(17)).toBe(16);
    expect(coerceFontSizePx(11)).toBe(12);
    expect(coerceFontSizePx(13)).toBe(14);
    expect(coerceFontSizePx(15)).toBe(16);
    expect(coerceFontSizePx(18)).toBe(16);
  });
});

describe("themeSettingsToCss", () => {
  it("uses stronger dark surface contrast and accent-forward hovers", () => {
    const css = themeSettingsToCss(DEFAULT_THEME_SETTINGS);
    expect(css).toMatch(/--bg: #050505;/);
    expect(css).toMatch(/--bg-secondary: color-mix\(in oklab, #050505 88%, color-mix\(in oklab, #f5f5f5 74%, #f2ff00\)\)/);
    expect(css).toMatch(/--selection-bg: color-mix\(in oklab, #f2ff00 80%, #050505\)/);
    expect(css).toMatch(/sidebar-control-active-hover-bg:[^;]*color-mix\(in srgb, #f2ff00 88%/);
  });

  it("uses stronger light-theme surface contrast", () => {
    const light = THEME_PRESETS.find((p) => p.id === "light")!.colors;
    const css = themeSettingsToCss({ ...DEFAULT_THEME_SETTINGS, ...light });
    expect(css).toMatch(/--bg-secondary: color-mix\(in oklab, #fafafa 88%, #0a0a0a\)/);
    expect(css).toMatch(/--selection-bg: color-mix\(in oklab, #0052ff 82%, #fafafa\)/);
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
