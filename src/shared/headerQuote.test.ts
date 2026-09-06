import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  HOME_HEADER_QUOTE,
  HOME_HEADER_QUOTE_BAG_KEY,
  HOME_HEADER_QUOTES,
  formatHomeHeaderQuoteTooltip,
  homeHeaderQuoteNote,
  nextHomeHeaderQuote,
  shuffleIds,
  type HomeHeaderQuote,
  type HomeHeaderQuoteBagState,
} from "./headerQuote";

const root = join(__dirname, "../..");

function readContract(): { quotes: HomeHeaderQuote[] } {
  const raw = readFileSync(join(root, "resources/contracts/homeHeaderQuotes.json"), "utf8");
  return JSON.parse(raw) as { quotes: HomeHeaderQuote[] };
}

function memoryStorage(initial?: HomeHeaderQuoteBagState) {
  let value = initial ? JSON.stringify(initial) : null;
  return {
    getItem(key: string): string | null {
      return key === HOME_HEADER_QUOTE_BAG_KEY ? value : null;
    },
    setItem(key: string, next: string): void {
      if (key === HOME_HEADER_QUOTE_BAG_KEY) value = next;
    },
    read(): HomeHeaderQuoteBagState | null {
      if (!value) return null;
      return JSON.parse(value) as HomeHeaderQuoteBagState;
    },
  };
}

describe("resources/contracts/homeHeaderQuotes.json", () => {
  it("exports ~24 non-empty short quotes with metadata", () => {
    const c = readContract();
    expect(c.quotes.length).toBeGreaterThanOrEqual(20);
    expect(c.quotes.length).toBeLessThanOrEqual(30);
    const ids = new Set<string>();
    for (const q of c.quotes) {
      expect(q.id.trim().length).toBeGreaterThan(0);
      expect(ids.has(q.id)).toBe(false);
      ids.add(q.id);
      expect(q.short.trim().length).toBeGreaterThan(0);
      expect(q.short.length).toBeLessThanOrEqual(32);
      expect(q.full.includes(q.short)).toBe(true);
      expect(q.author.trim().length).toBeGreaterThan(0);
      expect(q.source.trim().length).toBeGreaterThan(0);
      expect(q.context.trim().length).toBeGreaterThan(0);
      expect(q.moral.trim().length).toBeGreaterThan(0);
      expect(["teach", "intrigue", "remind", "center"]).toContain(q.job);
    }
  });

  it("matches TS imports from the same file", () => {
    expect([...HOME_HEADER_QUOTES]).toEqual(readContract().quotes);
    expect(HOME_HEADER_QUOTE).toBe(HOME_HEADER_QUOTES[0]?.short);
  });

  it("is bundled for iOS (pbxproj resource)", () => {
    const pbx = readFileSync(join(root, "ios/HarnessMobile.xcodeproj/project.pbxproj"), "utf8");
    expect(pbx).toContain("homeHeaderQuotes.json in Resources");
  });
});

describe("nextHomeHeaderQuote", () => {
  it("draws without repeating until the bag is exhausted", () => {
    const storage = memoryStorage();
    const random = () => 0; // deterministic shuffle (swap with index 0 each step → reverse-ish)
    const seen: string[] = [];
    for (let i = 0; i < HOME_HEADER_QUOTES.length; i++) {
      const q = nextHomeHeaderQuote({ storage, random });
      expect(seen).not.toContain(q.id);
      seen.push(q.id);
    }
    expect(seen).toHaveLength(HOME_HEADER_QUOTES.length);
    expect(new Set(seen).size).toBe(HOME_HEADER_QUOTES.length);

    // Bag empty → reshuffle and continue
    const again = nextHomeHeaderQuote({ storage, random });
    expect(HOME_HEADER_QUOTES.some((q) => q.id === again.id)).toBe(true);
  });

  it("persists remaining ids after each draw", () => {
    const storage = memoryStorage({ remaining: ["didion-stories", "orwell-windowpane"] });
    const first = nextHomeHeaderQuote({ storage, random: () => 0 });
    expect(first.id).toBe("didion-stories");
    expect(storage.read()?.remaining).toEqual(["orwell-windowpane"]);
    const second = nextHomeHeaderQuote({ storage, random: () => 0 });
    expect(second.id).toBe("orwell-windowpane");
    expect(storage.read()?.remaining).toEqual([]);
  });

  it("formats tooltip with attribution and one wrapping note", () => {
    const q = HOME_HEADER_QUOTES[0]!;
    expect(homeHeaderQuoteNote(q)).toBe(`${q.context} ${q.moral}`);
    expect(formatHomeHeaderQuoteTooltip(q)).toBe(`${q.author}, ${q.source}\n${q.context} ${q.moral}`);
  });
});

describe("shuffleIds", () => {
  it("returns a permutation of the input", () => {
    const ids = HOME_HEADER_QUOTES.map((q) => q.id);
    const shuffled = shuffleIds(ids, () => 0.5);
    expect(shuffled).toHaveLength(ids.length);
    expect(new Set(shuffled)).toEqual(new Set(ids));
  });
});
