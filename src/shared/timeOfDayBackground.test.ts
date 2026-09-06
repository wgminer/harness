import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TIME_OF_DAY_PREVIEW,
  SHELL_BG,
  SHELL_TINT_TOKENS,
  WORLD_CLOCK_HOUR_COLORS,
  applyAppearanceTheme,
  applyTimeOfDayBackground,
  clearTimeOfDayBackground,
  formatHourClock,
  isTimeThemeActive,
  todVarName,
  hourColorAt,
  hourInTimeZone,
  hourPhaseLabel,
  interpolateHourColor,
  mixHex,
  parseTimeOfDayPreview,
  resetTimeOfDayPreview,
  resolveHour,
  setTimeOfDayPreview,
  subscribeTimeOfDayPreview,
  shellColorsForHour,
  skyBrightness,
  skyMixForBackground,
  wrapHour,
} from "./timeOfDayBackground";

beforeEach(() => {
  resetTimeOfDayPreview({ persist: false, apply: false });
  clearTimeOfDayBackground(null);
});

afterEach(() => {
  resetTimeOfDayPreview({ persist: false, apply: false });
  clearTimeOfDayBackground(null);
});

describe("timeOfDayBackground", () => {
  it("maps chrome tokens onto --tod-* names", () => {
    expect(todVarName("--bg")).toBe("--tod-bg");
    expect(todVarName("--bg-secondary")).toBe("--tod-bg-secondary");
  });

  it("keeps the world-clock 24-hour palette", () => {
    expect(WORLD_CLOCK_HOUR_COLORS).toHaveLength(24);
    expect(WORLD_CLOCK_HOUR_COLORS[0]).toBe("#1a237e");
    expect(WORLD_CLOCK_HOUR_COLORS[12]).toBe("#ffeb3b");
    expect(WORLD_CLOCK_HOUR_COLORS[18]).toBe("#ff6f00");
    expect(WORLD_CLOCK_HOUR_COLORS[23]).toBe("#1a237e");
  });

  it("looks up discrete hour colors the way ClockCard does", () => {
    expect(hourColorAt(0)).toBe("#1a237e");
    expect(hourColorAt(12.9)).toBe("#ffeb3b");
    expect(hourColorAt(24)).toBe("#1a237e");
    expect(hourColorAt(-1)).toBe("#1a237e");
  });

  it("interpolates halfway between adjacent hours", () => {
    expect(interpolateHourColor(12)).toBe("#ffeb3b");
    expect(interpolateHourColor(12.5)).toBe(mixHex("#ffeb3b", "#fff176", 0.5));
    expect(interpolateHourColor(23.5)).toBe(mixHex("#1a237e", "#1a237e", 0.5));
  });

  it("wraps hours into 0–24", () => {
    expect(wrapHour(25)).toBe(1);
    expect(wrapHour(-0.25)).toBe(23.75);
  });

  it("tints the dark shell toward the sky instead of replacing it", () => {
    const noon = shellColorsForHour(12);
    expect(noon.sky).toBe("#ffeb3b");
    expect(noon.bg).toBe(mixHex(SHELL_BG, "#ffeb3b", skyMixForBackground("#ffeb3b")));
    expect(noon.bg).not.toBe("#ffeb3b");
    expect(noon.bg).not.toBe(SHELL_BG);
  });

  it("mixes less of bright skies than dark ones", () => {
    expect(skyMixForBackground("#1a237e")).toBeGreaterThan(skyMixForBackground("#ffeb3b"));
    const midnight = shellColorsForHour(0);
    const noon = shellColorsForHour(12);
    expect(skyBrightness(midnight.bg)).toBeLessThan(skyBrightness(noon.bg));
  });

  it("tints every inventoried chrome token, not just --bg", () => {
    const evening = shellColorsForHour(18);
    expect(Object.keys(evening.tokens)).toEqual(SHELL_TINT_TOKENS.map((token) => token.name));
    for (const token of SHELL_TINT_TOKENS) {
      expect(evening.tokens[token.name]).not.toBe(token.hex);
    }
    const none = shellColorsForHour(18, 0);
    for (const token of SHELL_TINT_TOKENS) {
      expect(none.tokens[token.name]).toBe(token.hex);
    }
  });

  it("lets ?tod= override the clock", () => {
    const evening = new Date(2026, 8, 4, 9, 0, 0);
    expect(resolveHour(evening, "?tod=18")).toBe(18);
    expect(resolveHour(evening, "tod=3.25")).toBe(3.25);
    expect(resolveHour(evening, "?tod=nope")).toBe(9);
    expect(resolveHour(evening, "")).toBe(9);
  });

  it("lets a debugger pin win over ?tod= and the clock", () => {
    const morning = new Date(2026, 8, 4, 9, 0, 0);
    expect(
      resolveHour(morning, "?tod=18", { hour: 21.5, timeZone: null, tintScale: 1 }),
    ).toBe(21.5);
  });

  it("uses an IANA zone when the hour is not pinned", () => {
    const utcNoon = new Date("2026-09-04T12:00:00Z");
    expect(
      resolveHour(utcNoon, "", { hour: null, timeZone: "UTC", tintScale: 1 }),
    ).toBe(12);
    expect(
      resolveHour(utcNoon, "", { hour: null, timeZone: "America/New_York", tintScale: 1 }),
    ).toBe(8);
    expect(
      resolveHour(utcNoon, "", { hour: null, timeZone: "Asia/Tokyo", tintScale: 1 }),
    ).toBe(21);
  });

  it("formats clock labels and phases", () => {
    expect(formatHourClock(0)).toBe("12:00 AM");
    expect(formatHourClock(20.4)).toBe("8:24 PM");
    expect(hourPhaseLabel(20)).toBe("dusk");
    expect(hourPhaseLabel(12)).toBe("noon");
  });

  it("reads a stored preview", () => {
    expect(parseTimeOfDayPreview(null)).toEqual(DEFAULT_TIME_OF_DAY_PREVIEW);
    expect(
      parseTimeOfDayPreview(
        JSON.stringify({ hour: 18.25, timeZone: "Europe/Paris", tintScale: 0.5 }),
      ),
    ).toEqual({ hour: 18.25, timeZone: "Europe/Paris", tintScale: 0.5 });
    expect(parseTimeOfDayPreview(JSON.stringify({ timeZone: "Not/AZone", tintScale: 9 }))).toEqual({
      hour: null,
      timeZone: null,
      tintScale: 1.5,
    });
  });

  it("writes every chrome token onto a style target", () => {
    const props: Record<string, string> = {};
    const dataset: { appearance?: string; todHour?: string; todZone?: string; todTint?: string } = {};
    const colors = applyTimeOfDayBackground(
      new Date(2026, 8, 4, 18, 0, 0),
      {
        style: {
          setProperty: (name, value) => { props[name] = value; },
          removeProperty: (name) => { delete props[name]; },
        },
        dataset,
      },
      "",
      { hour: null, timeZone: null, tintScale: 1 },
    );
    expect(props["--time-sky"]).toBe(colors.sky);
    expect(props[todVarName("--time-sky")]).toBe(colors.sky);
    for (const token of SHELL_TINT_TOKENS) {
      expect(props[token.name]).toBe(colors.tokens[token.name]);
      expect(props[todVarName(token.name)]).toBe(colors.tokens[token.name]);
    }
    expect(dataset.appearance).toBe("time");
    expect(dataset.todHour).toBe("18");
    expect(dataset.todZone).toBe("local");
    expect(dataset.todTint).toBe("1");
  });

  it("keeps hourInTimeZone aligned with resolveHour", () => {
    const utcNoon = new Date("2026-09-04T12:00:00Z");
    expect(hourInTimeZone(utcNoon, "UTC")).toBe(12);
    expect(hourInTimeZone(utcNoon, "America/Los_Angeles")).toBe(5);
  });

  it("applies or clears the shell from the System theme", () => {
    const props: Record<string, string> = {};
    const dataset: { appearance?: string; todHour?: string; todZone?: string; todTint?: string } = {};
    const root = {
      style: {
        setProperty: (name: string, value: string) => { props[name] = value; },
        removeProperty: (name: string) => { delete props[name]; },
      },
      dataset,
    };
    applyAppearanceTheme("time", new Date(2026, 8, 4, 18, 0, 0), root, "");
    expect(isTimeThemeActive()).toBe(true);
    expect(props["--bg"]).toBeTruthy();
    expect(props[todVarName("--bg")]).toBe(props["--bg"]);
    expect(dataset.appearance).toBe("time");
    expect(dataset.todHour).toBe("18");
    applyAppearanceTheme("dark", new Date(2026, 8, 4, 18, 0, 0), root, "");
    expect(isTimeThemeActive()).toBe(false);
    expect(props["--bg"]).toBeUndefined();
    expect(props[todVarName("--bg")]).toBeUndefined();
    expect(dataset.appearance).toBe("dark");
    expect(dataset.todHour).toBeUndefined();
    clearTimeOfDayBackground(root);
  });

  it("follows the clock for System Time, ignoring a leftover debugger pin", () => {
    const props: Record<string, string> = {};
    const dataset: { appearance?: string; todHour?: string; todZone?: string; todTint?: string } = {};
    const root = {
      style: {
        setProperty: (name: string, value: string) => { props[name] = value; },
        removeProperty: (name: string) => { delete props[name]; },
      },
      dataset,
    };
    setTimeOfDayPreview({ hour: 12, tintScale: 0 }, { persist: false, apply: false });
    applyAppearanceTheme("time", new Date(2026, 8, 4, 18, 0, 0), root, "");
    expect(dataset.todHour).toBe("18");
    expect(dataset.todTint).toBe("1");
    expect(props["--bg"]).not.toBe(SHELL_BG);
    clearTimeOfDayBackground(root);
  });

  it("notifies subscribers when the debugger preview changes", () => {
    const received: Array<number | null> = [];
    const off = subscribeTimeOfDayPreview((next) => {
      received.push(next.hour);
    });
    setTimeOfDayPreview({ hour: 7 }, { persist: false, apply: false });
    expect(received).toEqual([7]);
    off();
    setTimeOfDayPreview({ hour: 8 }, { persist: false, apply: false });
    expect(received).toEqual([7]);
  });
});
