import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_PARAKEET_MANIFEST_URL,
  getParakeetManifestUrl,
  parseParakeetManifest,
} from "./parakeetModel";

describe("parakeetModel", () => {
  const prev = process.env.PARAKEET_MANIFEST_URL;

  afterEach(() => {
    if (prev === undefined) delete process.env.PARAKEET_MANIFEST_URL;
    else process.env.PARAKEET_MANIFEST_URL = prev;
  });

  it("uses default HF manifest URL", () => {
    delete process.env.PARAKEET_MANIFEST_URL;
    expect(getParakeetManifestUrl()).toBe(DEFAULT_PARAKEET_MANIFEST_URL);
  });

  it("honors PARAKEET_MANIFEST_URL override", () => {
    process.env.PARAKEET_MANIFEST_URL = "http://127.0.0.1:9999/manifest.json";
    expect(getParakeetManifestUrl()).toBe("http://127.0.0.1:9999/manifest.json");
  });

  it("parses a valid manifest", () => {
    const m = parseParakeetManifest({
      version: "1",
      model: "parakeet-tdt-0.6b-v3",
      files: {
        weights: {
          sha256: "a".repeat(64),
          bytes: 100,
          url: "https://example.com/w",
        },
        vocab: {
          sha256: "b".repeat(64),
          bytes: 50,
          url: "https://example.com/v",
        },
      },
    });
    expect(m.version).toBe("1");
    expect(m.files.weights.bytes).toBe(100);
  });
});
