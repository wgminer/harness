import { randomBytes } from "crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import { fileExists } from "./utils";

export interface ParseJsonResult<T> {
  value: T;
  /** True when trailing bytes after a valid JSON value were stripped. */
  repaired: boolean;
}

/** Index of the first byte after a complete top-level JSON value (for trailing-garbage recovery). */
export function jsonExtraDataEndIndex(err: unknown): number | null {
  if (!(err instanceof SyntaxError)) return null;
  if (!/after JSON/i.test(err.message)) return null;
  const match = err.message.match(/(?:at position|char) (\d+)/);
  if (!match) return null;
  const index = Number(match[1]);
  return Number.isFinite(index) && index > 0 ? index : null;
}

export function parseJsonUtf8<T>(raw: string): ParseJsonResult<T> {
  const text = raw.trim();
  if (!text) {
    return { value: {} as T, repaired: false };
  }
  try {
    return { value: JSON.parse(text) as T, repaired: false };
  } catch (err) {
    const end = jsonExtraDataEndIndex(err);
    if (end == null) throw err;
    return { value: JSON.parse(text.slice(0, end)) as T, repaired: true };
  }
}

const writeChains = new Map<string, Promise<void>>();

async function atomicWriteUtf8Once(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(8).toString("hex")}`;
  try {
    await writeFile(tmp, data, "utf-8");
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Serialize writes per destination path and use unique temp files to avoid rename races. */
export async function atomicWriteUtf8(path: string, data: string): Promise<void> {
  const prior = writeChains.get(path) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(() => atomicWriteUtf8Once(path, data));
  writeChains.set(path, next);
  try {
    await next;
  } finally {
    if (writeChains.get(path) === next) writeChains.delete(path);
  }
}

export async function readJsonObjectFile<T extends Record<string, unknown>>(
  path: string,
  options?: { repair?: boolean },
): Promise<ParseJsonResult<T>> {
  if (!(await fileExists(path))) {
    return { value: {} as T, repaired: false };
  }
  const raw = await readFile(path, "utf-8");
  const parsed = parseJsonUtf8<T>(raw);
  if (parsed.repaired && options?.repair !== false) {
    const stamp = Date.now();
    await writeFile(`${path}.corrupt-${stamp}`, raw, "utf-8");
    await atomicWriteUtf8(path, JSON.stringify(parsed.value, null, 2));
  }
  return parsed;
}

/**
 * Read a JSON array file without ever throwing on empty/partial/corrupt content.
 * Empty or missing files yield `[]`; trailing garbage is trimmed; unrecoverable
 * content is backed up to `<path>.corrupt-<ts>` and reset to `[]`. Repairs are
 * rewritten atomically so subsequent reads are clean.
 */
export async function readJsonArrayFile<T>(
  path: string,
  options?: { repair?: boolean },
): Promise<T[]> {
  if (!(await fileExists(path))) return [];
  const raw = await readFile(path, "utf-8");
  const text = raw.trim();
  if (!text) return [];

  let parsed: unknown;
  let repaired = false;
  let corrupt = false;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    const end = jsonExtraDataEndIndex(err);
    if (end != null) {
      try {
        parsed = JSON.parse(text.slice(0, end));
        repaired = true;
      } catch {
        corrupt = true;
      }
    } else {
      corrupt = true;
    }
  }

  const value = Array.isArray(parsed) ? (parsed as T[]) : [];
  if ((repaired || corrupt) && options?.repair !== false) {
    if (corrupt) {
      await writeFile(`${path}.corrupt-${Date.now()}`, raw, "utf-8").catch(() => {});
    }
    await atomicWriteUtf8(path, JSON.stringify(value, null, 2)).catch(() => {});
  }
  return value;
}
