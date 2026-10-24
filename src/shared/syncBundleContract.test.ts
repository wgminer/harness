import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");

type SyncBundleContract = {
  bundleFormatVersion: number;
  readableBundleFormatVersions: number[];
  blobPathPrefixes: string[];
  blobObjectPrefix: string;
};

type RevisionFixture = {
  files: { path: string; text: string }[];
  blobHashes: Record<string, string>;
  revision: string;
  contentRevision: string;
};

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

const contract = JSON.parse(read("resources/contracts/syncBundle.json")) as SyncBundleContract;

function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** The revision rule both clients implement: blob paths contribute their hex sha256, not their bytes. */
function revision(files: RevisionFixture["files"], scopePrefix: string | null): string {
  const hasher = createHash("sha256");
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    if (scopePrefix && !file.path.startsWith(scopePrefix)) continue;
    const isBlob = contract.blobPathPrefixes.some((prefix) => file.path.startsWith(prefix));
    hasher.update(file.path);
    hasher.update(Buffer.from([0]));
    hasher.update(isBlob ? sha256Hex(file.text) : file.text);
    hasher.update(Buffer.from([0]));
  }
  return hasher.digest("hex");
}

describe("resources/contracts/syncBundle.json", () => {
  it("writes a format it can read and keeps format 1 readable", () => {
    expect(contract.readableBundleFormatVersions).toContain(contract.bundleFormatVersion);
    expect(contract.readableBundleFormatVersions).toContain(1);
    expect(contract.blobPathPrefixes.length).toBeGreaterThan(0);
    for (const prefix of contract.blobPathPrefixes) {
      expect(prefix.startsWith("app-state/")).toBe(true);
      expect(prefix.endsWith("/")).toBe(true);
    }
    expect(contract.blobObjectPrefix.endsWith("/")).toBe(true);
  });

  it("is the Rust source for the format version and blob paths", () => {
    const bundle = read("src-tauri/src/sync/bundle.rs");
    expect(bundle).toContain('include_str!("../../../resources/contracts/syncBundle.json")');
    expect(bundle).not.toContain("BUNDLE_FORMAT_VERSION");
    for (const file of ["sync.rs", "sync/bundle.rs", "sync/remote_store.rs"]) {
      const source = read(`src-tauri/src/${file}`);
      expect(source).not.toContain('"app-state/chat-attachments/"');
      expect(source).not.toMatch(/const [A-Z_]*BLOB[A-Z_]*PREFIX/);
    }
  });

  it("agrees with the golden revision fixture the Rust tests assert", () => {
    const fixture = JSON.parse(
      read("src/shared/fixtures/syncBundle/revision.expected.json"),
    ) as RevisionFixture;
    for (const [path, hash] of Object.entries(fixture.blobHashes)) {
      const file = fixture.files.find((f) => f.path === path);
      expect(file && sha256Hex(file.text)).toBe(hash);
    }
    const blobPaths = fixture.files
      .map((f) => f.path)
      .filter((path) => contract.blobPathPrefixes.some((prefix) => path.startsWith(prefix)));
    expect(blobPaths.sort()).toEqual(Object.keys(fixture.blobHashes).sort());
    expect(revision(fixture.files, null)).toBe(fixture.revision);
    expect(revision(fixture.files, "app-state/")).toBe(fixture.contentRevision);
  });
});
