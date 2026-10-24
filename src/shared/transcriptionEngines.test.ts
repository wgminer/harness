import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRANSCRIPTION_ENGINE,
  TRANSCRIPTION_ENGINES,
  normalizeTranscriptionEngine,
} from "./transcriptionEngines";

const root = join(__dirname, "../..");

describe("transcriptionEngines contract", () => {
  it("defaults to Apple Speech", () => {
    expect(DEFAULT_TRANSCRIPTION_ENGINE).toBe("apple");
    expect(TRANSCRIPTION_ENGINES.map((e) => e.id)).toEqual(["apple", "parakeet"]);
  });

  it("normalizes unknown values to the default", () => {
    expect(normalizeTranscriptionEngine("parakeet")).toBe("parakeet");
    expect(normalizeTranscriptionEngine("whisper")).toBe("apple");
    expect(normalizeTranscriptionEngine(undefined)).toBe("apple");
  });

  it("matches the engine ids the Rust settings parser accepts", () => {
    const rust = readFileSync(
      join(root, "src-tauri/src/recording/transcription_engine.rs"),
      "utf8",
    );
    for (const { id } of TRANSCRIPTION_ENGINES) {
      expect(rust).toContain(`=> "${id}"`);
    }
  });
});
