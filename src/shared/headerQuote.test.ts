import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOME_HEADER_QUOTE,
  HOME_HEADER_QUOTES,
  homeHeaderQuoteForDate,
  homeHeaderQuoteIndex,
  utcDayIndex,
} from "./headerQuote";

const root = join(__dirname, "../..");

function readContract(): { quotes: string[] } {
  const raw = readFileSync(join(root, "resources/contracts/homeHeaderQuotes.json"), "utf8");
  return JSON.parse(raw) as { quotes: string[] };
}

describe("resources/contracts/homeHeaderQuotes.json", () => {
  it("exports five non-empty short quotes", () => {
    const c = readContract();
    expect(c.quotes).toHaveLength(5);
    for (const q of c.quotes) {
      expect(q.trim().length).toBeGreaterThan(0);
      expect(q.length).toBeLessThanOrEqual(32);
    }
  });

  it("matches TS imports from the same file", () => {
    expect([...HOME_HEADER_QUOTES]).toEqual(readContract().quotes);
    expect(HOME_HEADER_QUOTE).toBe(HOME_HEADER_QUOTES[0]);
  });

  it("is bundled for iOS (pbxproj resource)", () => {
    const pbx = readFileSync(join(root, "ios/HarnessMobile.xcodeproj/project.pbxproj"), "utf8");
    expect(pbx).toContain("homeHeaderQuotes.json in Resources");
  });
});

describe("homeHeaderQuoteForDate", () => {
  it("rotates by UTC day index", () => {
    const day0 = new Date(0);
    const day1 = new Date(86_400_000);
    expect(utcDayIndex(day0)).toBe(0);
    expect(utcDayIndex(day1)).toBe(1);
    expect(homeHeaderQuoteIndex(day0)).toBe(0);
    expect(homeHeaderQuoteIndex(day1)).toBe(1);
    expect(homeHeaderQuoteForDate(day0)).toBe(HOME_HEADER_QUOTES[0]);
    expect(homeHeaderQuoteForDate(day1)).toBe(HOME_HEADER_QUOTES[1]);
  });

  it("wraps after the last quote", () => {
    const n = HOME_HEADER_QUOTES.length;
    const day = new Date(n * 86_400_000);
    expect(homeHeaderQuoteForDate(day)).toBe(HOME_HEADER_QUOTES[0]);
  });
});
