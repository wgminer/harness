import { describe, expect, it } from "vitest";
import {
  CONFIG_ENTRIES,
  buildDefaultViewSpec,
  getAllConfigEntryIds,
  getConfigEntry,
  normalizeConfigViewSpec,
  validateConfigViewSpec,
} from "./configRegistry";

describe("configRegistry", () => {
  it("has unique entry ids", () => {
    const ids = CONFIG_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry has a valid store and control", () => {
    for (const entry of CONFIG_ENTRIES) {
      expect(["settings", "theme", "layout"]).toContain(entry.store);
      expect(entry.path.length).toBeGreaterThan(0);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(getConfigEntry(entry.id)).toBe(entry);
    }
  });

  it("buildDefaultViewSpec includes every catalog entry once", () => {
    const spec = buildDefaultViewSpec();
    const ids = spec.sections.flatMap((s) => s.entryIds);
    expect(ids.sort()).toEqual(getAllConfigEntryIds().sort());
  });

  it("validateConfigViewSpec rejects unknown entry ids", () => {
    const spec = {
      sections: [{ title: "Bad", entryIds: ["not.real"] }],
    };
    expect(validateConfigViewSpec(spec)).toMatch(/Unknown config entry/);
  });

  it("normalizeConfigViewSpec filters invalid ids", () => {
    const spec = normalizeConfigViewSpec({
      title: "Test",
      sections: [
        {
          title: "OpenAI",
          entryIds: ["openai.apiKey", "bogus.id"],
        },
      ],
    });
    expect(spec?.sections[0]?.entryIds).toEqual(["openai.apiKey"]);
  });
});
