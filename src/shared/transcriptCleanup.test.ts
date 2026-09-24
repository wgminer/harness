import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import contract from "../../resources/contracts/transcriptCleanup.json";
import {
  appendPreferredSpellings,
  DEFAULT_TRANSCRIPT_CLEANUP_PROMPT,
  glossaryFromLegacyDictionary,
  LEGACY_TRANSCRIPT_CLEANUP_PROMPT,
  mergeGlossary,
  migrateCleanupPrompt,
  normalizeGlossary,
  PREFERRED_SPELLINGS_HEADER,
  resolveGlossary,
} from "./transcriptCleanup";
import { DEFAULT_SETTINGS } from "./types";

const root = join(import.meta.dirname, "../..");

describe("resources/contracts/transcriptCleanup.json", () => {
  it("has prompt and preferred-spellings header strings", () => {
    expect(contract.defaultPrompt).toBe(DEFAULT_TRANSCRIPT_CLEANUP_PROMPT);
    expect(contract.legacyDefaultPrompt).toBe(LEGACY_TRANSCRIPT_CLEANUP_PROMPT);
    expect(contract.preferredSpellingsHeader).toBe(PREFERRED_SPELLINGS_HEADER);
    expect(DEFAULT_TRANSCRIPT_CLEANUP_PROMPT.length).toBeGreaterThan(40);
    expect(PREFERRED_SPELLINGS_HEADER).toMatch(/Preferred spellings/i);
    expect(DEFAULT_TRANSCRIPT_CLEANUP_PROMPT).toMatch(/listed spellings/i);
  });

  it("is include_str!'d by Rust", () => {
    const rust = readFileSync(join(root, "src-tauri/src/transcript_cleanup.rs"), "utf8");
    expect(rust).toContain('include_str!("../../resources/contracts/transcriptCleanup.json")');
  });

  it("matches DEFAULT_SETTINGS cleanup prompt", () => {
    expect(DEFAULT_SETTINGS.transcription?.cleanup?.prompt).toBe(DEFAULT_TRANSCRIPT_CLEANUP_PROMPT);
  });
});

describe("normalizeGlossary", () => {
  it("trims, drops empties, and dedupes case-insensitively", () => {
    expect(normalizeGlossary([" Cursor ", "", "cursor", "Harness"])).toEqual(["Cursor", "Harness"]);
  });
});

describe("resolveGlossary", () => {
  it("reads glossary when present even if empty", () => {
    expect(resolveGlossary({ glossary: [], dictionary: [{ from: "c", to: "Cursor" }] })).toEqual([]);
    expect(resolveGlossary({ glossary: ["Harness"] })).toEqual(["Harness"]);
  });

  it("migrates legacy dictionary to the replacement term", () => {
    expect(
      glossaryFromLegacyDictionary([
        { from: "cursor", to: "Cursor" },
        { from: "um", to: "" },
        { from: "Harness", to: "Harness" },
      ]),
    ).toEqual(["Cursor", "Harness"]);
    expect(resolveGlossary({ dictionary: [{ from: "tavily", to: "Tavily" }] })).toEqual(["Tavily"]);
  });
});

describe("mergeGlossary", () => {
  it("keeps current glossary when a partial omits it", () => {
    expect(mergeGlossary({ cleanup: { enabled: true } }, { glossary: ["Cursor"] })).toEqual(["Cursor"]);
  });

  it("migrates a legacy partial when current is empty", () => {
    expect(mergeGlossary({ dictionary: [{ from: "h", to: "Harness" }] }, { glossary: [] })).toEqual([
      "Harness",
    ]);
  });
});

describe("migrateCleanupPrompt", () => {
  it("upgrades the legacy default and empty prompts", () => {
    expect(migrateCleanupPrompt("")).toBe(DEFAULT_TRANSCRIPT_CLEANUP_PROMPT);
    expect(migrateCleanupPrompt(LEGACY_TRANSCRIPT_CLEANUP_PROMPT)).toBe(
      DEFAULT_TRANSCRIPT_CLEANUP_PROMPT,
    );
    expect(migrateCleanupPrompt("Keep filler.")).toBe("Keep filler.");
  });
});

describe("appendPreferredSpellings", () => {
  it("returns the prompt unchanged when the glossary is empty", () => {
    expect(appendPreferredSpellings("Keep it terse.", [])).toBe("Keep it terse.");
  });

  it("appends a bullet list after the header", () => {
    const out = appendPreferredSpellings("Keep it terse.", ["Cursor", "Harness"]);
    expect(out).toBe(
      `Keep it terse.\n\n${PREFERRED_SPELLINGS_HEADER}\n- Cursor\n- Harness`,
    );
  });
});
