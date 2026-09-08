import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { releaseNotes } = require("../../scripts/publish-github-release.js") as {
  releaseNotes: (version: string) => string;
};

describe("GitHub release notes", () => {
  it("tells people to download the DMG and skip updater files", () => {
    const notes = releaseNotes("0.10.0");
    expect(notes).toContain("**Download `harness-v0.10.0-mac.dmg`.**");
    expect(notes).toContain("drag **Harness** into Applications");
    expect(notes).toContain("harness-v0.10.0-mac.zip");
    expect(notes).toContain("harness-v0.10.0-mac.app.tar.gz");
    expect(notes).toContain("latest.json");
    expect(notes).toMatch(/skip these/i);
  });
});
