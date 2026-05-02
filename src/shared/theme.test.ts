import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_SETTINGS,
  enforceVeryLowContrastGuard,
  normalizeThemeSettings,
  themeSettingsToCss,
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
    expect(css).toContain("--border:");
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
