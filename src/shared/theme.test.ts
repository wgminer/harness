import { describe, expect, it } from "vitest";
import {
  applyThemeColors,
  coerceFontSizePx,
  DEFAULT_THEME_SETTINGS,
  enforceVeryLowContrastGuard,
  findThemePreset,
  FONT_SIZE_OPTIONS,
  matchThemePresetId,
  migrateThemeToPreset,
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

  it("accepts proportional serif as editor font", () => {
    const t = normalizeThemeSettings({
      accent: "#d4ff00",
      font: "ui_serif",
      fontMono: "ui_serif",
      fontSize: 14,
    });
    expect(t.font).toBe("ui_serif");
    expect(t.fontMono).toBe("ui_serif");
  });
});

describe("THEME_PRESETS", () => {
  it("exposes dark and light themes", () => {
    expect(THEME_PRESETS).toHaveLength(2);
    expect(THEME_PRESETS.map((p) => p.id)).toEqual(["dark", "light"]);
  });

  it("resolves legacy preset aliases", () => {
    expect(resolveThemePresetId("night")).toBe("dark");
    expect(resolveThemePresetId("paper")).toBe("light");
    expect(resolveThemePresetId("matcha")).toBe("dark");
    expect(resolveThemePresetId("ik_blue")).toBe("dark");
    expect(resolveThemePresetId("green")).toBe("dark");
    expect(findThemePreset("bloomberg")?.id).toBe("dark");
  });
});

describe("matchThemePresetId", () => {
  it("returns exact preset match", () => {
    expect(matchThemePresetId(DEFAULT_THEME_SETTINGS)).toBe("dark");
    const light = applyThemeColors(DEFAULT_THEME_SETTINGS, THEME_PRESETS.find((p) => p.id === "light")!.colors);
    expect(matchThemePresetId(light)).toBe("light");
  });

  it("infers light from bright custom background", () => {
    const custom = { ...DEFAULT_THEME_SETTINGS, bg: "#ffffff", fg: "#111111", accent: "#0052ff" };
    expect(matchThemePresetId(custom)).toBe("light");
  });
});

describe("migrateThemeToPreset", () => {
  it("migrates legacy green preset colors to dark", () => {
    const green = {
      ...DEFAULT_THEME_SETTINGS,
      accent: "#32d74b",
      fg: "#b8f5a8",
      bg: "#031508",
    };
    const migrated = migrateThemeToPreset(green);
    expect(migrated.bg).toBe(DEFAULT_THEME_SETTINGS.bg);
    expect(migrated.accent).toBe(DEFAULT_THEME_SETTINGS.accent);
  });

  it("migrates legacy yellow dark preset to the new dark palette", () => {
    const legacy = {
      ...DEFAULT_THEME_SETTINGS,
      accent: "#f2ff00",
      fg: "#f5f5f5",
      bg: "#050505",
    };
    const migrated = migrateThemeToPreset(legacy);
    expect(migrated).toEqual(DEFAULT_THEME_SETTINGS);
  });

  it("migrates legacy gray light preset to the new white light palette", () => {
    const legacy = {
      ...DEFAULT_THEME_SETTINGS,
      accent: "#3b6fd9",
      fg: "#141820",
      bg: "#f6f7f9",
    };
    const migrated = migrateThemeToPreset(legacy);
    const light = THEME_PRESETS.find((p) => p.id === "light")!.colors;
    expect(migrated).toEqual(applyThemeColors(DEFAULT_THEME_SETTINGS, light));
  });

  it("leaves dark and light presets unchanged", () => {
    const light = applyThemeColors(DEFAULT_THEME_SETTINGS, THEME_PRESETS.find((p) => p.id === "light")!.colors);
    expect(migrateThemeToPreset(light)).toEqual(light);
    expect(migrateThemeToPreset(DEFAULT_THEME_SETTINGS)).toEqual(DEFAULT_THEME_SETTINGS);
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
    expect(css).toMatch(/--bg: #0b0d10;/);
    expect(css).toMatch(/--bg-secondary: color-mix\(in oklab, #0b0d10 88%, color-mix\(in oklab, #eceef2 74%, #5b9cf5\)\)/);
    expect(css).toMatch(/--selection-bg: color-mix\(in oklab, #5b9cf5 80%, #0b0d10\)/);
    expect(css).toMatch(/sidebar-control-active-hover-bg:[^;]*color-mix\(in srgb, #5b9cf5 88%/);
  });

  it("uses white secondary surfaces for light themes", () => {
    const light = THEME_PRESETS.find((p) => p.id === "light")!.colors;
    const css = themeSettingsToCss({ ...DEFAULT_THEME_SETTINGS, ...light });
    expect(css).toMatch(/--bg-secondary: #ffffff;/);
    expect(css).toMatch(/--bg-elevated: color-mix\(in oklab, #ffffff 96%, #b8bcc4\)/);
    expect(css).toMatch(/--selection-bg: color-mix\(in oklab, #3b6fd9 82%, #ffffff\)/);
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
