import { readFile, rename, writeFile } from "fs/promises";
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

export async function atomicWriteUtf8(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, data, "utf-8");
  await rename(tmp, path);
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
