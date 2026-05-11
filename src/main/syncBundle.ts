/**
 * Pure helpers for the folder-backup sync feature: walking included scopes,
 * hashing files for a deterministic revision, and packing/unpacking a single
 * portable bundle file.
 *
 * The bundle format is a gzipped JSON document:
 *   { version: 1, entries: [{ path, contents (base64), size }] }
 * This avoids any dependency on tar/zip libraries while staying simple to
 * inspect, version, and migrate. Files we sync are typically tiny JSON / text
 * (notes, settings, themes), so JSON+gzip is fine for any reasonable corpus.
 */

import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "fs/promises";
import { dirname, join, posix, relative, sep } from "path";
import { gunzipSync, gzipSync } from "zlib";

export const BUNDLE_FORMAT_VERSION = 1;

export interface BundleEntry {
  /** Posix-style path relative to `local-data/`. */
  path: string;
  /** Base64-encoded file contents. */
  contents: string;
  /** Decoded byte length (helps detect corruption without a full decode). */
  size: number;
}

export interface BundleDocument {
  version: number;
  entries: BundleEntry[];
}

/** Logical file/dir scopes that get included in the bundle. */
export interface SyncScope {
  /** Path under `local-data/` (posix style). */
  relPath: string;
  /** "file" = single file (skipped if missing); "dir" = recurse all files. */
  kind: "file" | "dir";
}

/** Default scopes the user expects to be backed up; recordings are intentionally excluded. */
export const DEFAULT_SYNC_SCOPES: readonly SyncScope[] = [
  { relPath: "app-state", kind: "dir" },
  { relPath: "settings/settings.json", kind: "file" },
  { relPath: "themes", kind: "dir" },
] as const;

function toPosix(p: string): string {
  return p.split(sep).join(posix.sep);
}

/**
 * Walk a directory recursively, returning **sorted** posix-relative paths so
 * the resulting list (and therefore any hash over it) is deterministic across
 * filesystems.
 */
async function walkFiles(root: string, baseAbs: string): Promise<string[]> {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  async function recurse(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await recurse(abs);
      } else if (entry.isFile()) {
        out.push(toPosix(relative(baseAbs, abs)));
      }
    }
  }
  await recurse(root);
  out.sort();
  return out;
}

/**
 * Resolve every concrete file path (relative to `local-data/`) covered by the
 * given scopes, in deterministic order.
 */
export async function listScopedFiles(
  localDataDir: string,
  scopes: readonly SyncScope[] = DEFAULT_SYNC_SCOPES,
): Promise<string[]> {
  const all: string[] = [];
  for (const scope of scopes) {
    const abs = join(localDataDir, scope.relPath);
    if (scope.kind === "file") {
      if (existsSync(abs)) all.push(toPosix(scope.relPath));
    } else {
      const found = await walkFiles(abs, localDataDir);
      for (const rel of found) all.push(rel);
    }
  }
  all.sort();
  return all;
}

/**
 * Compute a deterministic content hash for the included files. The hash mixes
 * the relative path AND the file bytes so renames or content edits both shift
 * the revision. Returns a hex digest.
 */
export async function computeRevision(
  localDataDir: string,
  scopes: readonly SyncScope[] = DEFAULT_SYNC_SCOPES,
): Promise<string> {
  const files = await listScopedFiles(localDataDir, scopes);
  const hasher = createHash("sha256");
  for (const rel of files) {
    const abs = join(localDataDir, rel);
    const data = await readFile(abs);
    hasher.update(rel);
    hasher.update("\u0000");
    hasher.update(data);
    hasher.update("\u0000");
  }
  return hasher.digest("hex");
}

/** Build a portable bundle (gzipped JSON) for the included files. */
export async function buildBundle(
  localDataDir: string,
  scopes: readonly SyncScope[] = DEFAULT_SYNC_SCOPES,
): Promise<{ bytes: Buffer; bundleHash: string; entries: BundleEntry[] }> {
  const files = await listScopedFiles(localDataDir, scopes);
  const entries: BundleEntry[] = [];
  for (const rel of files) {
    const abs = join(localDataDir, rel);
    const data = await readFile(abs);
    entries.push({
      path: rel,
      contents: data.toString("base64"),
      size: data.byteLength,
    });
  }
  const doc: BundleDocument = { version: BUNDLE_FORMAT_VERSION, entries };
  const json = Buffer.from(JSON.stringify(doc), "utf-8");
  const bytes = gzipSync(json, { level: 9 });
  const bundleHash = createHash("sha256").update(bytes).digest("hex");
  return { bytes, bundleHash, entries };
}

/** Decode a bundle file. Throws if the gzip/JSON is malformed. */
export function parseBundle(bytes: Buffer): BundleDocument {
  const json = gunzipSync(bytes).toString("utf-8");
  const parsed = JSON.parse(json) as BundleDocument;
  if (typeof parsed !== "object" || parsed == null || !Array.isArray(parsed.entries)) {
    throw new Error("Bundle is malformed (missing entries)");
  }
  if (parsed.version !== BUNDLE_FORMAT_VERSION) {
    throw new Error(`Unsupported bundle version: ${parsed.version}`);
  }
  return parsed;
}

/** Compute the hash of a bundle file's bytes (matches `bundleHash` in the manifest). */
export function hashBundleBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Move all files covered by `scopes` from `localDataDir` into `backupDir`,
 * preserving the relative path. Anything missing is silently skipped. Used as
 * a safety net **before** extracting a remote bundle so a bad pull never loses
 * data outright — the user can dig the previous state out of the backup dir.
 */
export async function backupScopedFiles(
  localDataDir: string,
  backupDir: string,
  scopes: readonly SyncScope[] = DEFAULT_SYNC_SCOPES,
): Promise<{ filesBackedUp: number }> {
  await mkdir(backupDir, { recursive: true });
  const files = await listScopedFiles(localDataDir, scopes);
  let count = 0;
  for (const rel of files) {
    const src = join(localDataDir, rel);
    const dst = join(backupDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    const data = await readFile(src);
    await writeFile(dst, data);
    count += 1;
  }
  return { filesBackedUp: count };
}

/**
 * Replace the in-scope local files with the bundle's contents. Files inside
 * the scoped paths that the bundle does NOT include are removed; files outside
 * the scopes (e.g. recordings) are left untouched.
 */
export async function extractBundle(
  localDataDir: string,
  doc: BundleDocument,
  scopes: readonly SyncScope[] = DEFAULT_SYNC_SCOPES,
): Promise<{ filesWritten: number }> {
  for (const scope of scopes) {
    const abs = join(localDataDir, scope.relPath);
    if (!existsSync(abs)) continue;
    if (scope.kind === "file") {
      await rm(abs, { force: true });
    } else {
      await rm(abs, { recursive: true, force: true });
    }
  }
  let count = 0;
  for (const entry of doc.entries) {
    if (!isInScope(entry.path, scopes)) continue;
    const abs = join(localDataDir, entry.path);
    await mkdir(dirname(abs), { recursive: true });
    const data = Buffer.from(entry.contents, "base64");
    if (data.byteLength !== entry.size) {
      throw new Error(`Bundle entry size mismatch for ${entry.path}`);
    }
    await writeFile(abs, data);
    count += 1;
  }
  return { filesWritten: count };
}

function isInScope(relPath: string, scopes: readonly SyncScope[]): boolean {
  for (const scope of scopes) {
    if (scope.kind === "file") {
      if (relPath === scope.relPath) return true;
    } else if (
      relPath === scope.relPath ||
      relPath.startsWith(scope.relPath + posix.sep)
    ) {
      return true;
    }
  }
  return false;
}

/** Atomic write: write to `<path>.tmp` first, then rename into place. */
export async function atomicWriteFile(path: string, data: Buffer | string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data);
  // `rm` of any stale dest is implicit — `rename` overwrites on POSIX, and we
  // are not crossing filesystems within a single backup folder.
  const { rename } = await import("fs/promises");
  await rename(tmp, path);
}

/** Used by Sync now to detect partially-downloaded bundles from cloud providers. */
export async function looksLikePlaceholder(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  try {
    const s = await stat(path);
    if (s.size === 0) return true;
    return false;
  } catch {
    return true;
  }
}

/** Heuristic for sibling iCloud `.icloud` placeholders (e.g. `.bundle.json.gz.icloud`). */
export function placeholderSiblingFor(filename: string): string {
  return `.${filename}.icloud`;
}
