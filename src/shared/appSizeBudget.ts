import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Physical line count matching `wc -l` (counts newlines / trailing partial line). */
export function physicalLineCount(text: string): number {
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  if (!text.endsWith("\n")) n++;
  return n;
}

/**
 * Strip Swift `#Preview… { … }` blocks (brace-balanced) so preview chrome
 * does not count toward size budgets.
 */
export function stripSwiftPreviewBlocks(text: string): string {
  const marker = "#Preview";
  let out = "";
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf(marker, i);
    if (start === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, start);
    let j = start + marker.length;
    while (j < text.length && text[j] !== "{") {
      // Skip attributes / name / whitespace before the opening brace.
      j++;
    }
    if (j >= text.length || text[j] !== "{") {
      // Malformed / incomplete preview — keep the rest as-is.
      out += text.slice(start);
      break;
    }
    let depth = 0;
    let k = j;
    for (; k < text.length; k++) {
      const ch = text[k];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          k++;
          break;
        }
      }
    }
    // Drop through the closing brace; also drop a single trailing newline if present.
    if (text[k] === "\n") k++;
    i = k;
  }
  return out;
}

/** Physical lines minus `#Preview` blocks. */
export function budgetLineCountSwift(text: string): number {
  return physicalLineCount(stripSwiftPreviewBlocks(text));
}

export function readPhysicalLineCount(path: string): number {
  return physicalLineCount(readFileSync(path, "utf8"));
}

export function readBudgetLineCountSwift(path: string): number {
  return budgetLineCountSwift(readFileSync(path, "utf8"));
}

export function walkFiles(
  dir: string,
  opts: {
    include: (name: string, fullPath: string) => boolean;
    skipDir?: (name: string) => boolean;
  },
): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".DS_Store") continue;
    if (opts.skipDir?.(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkFiles(full, opts));
    } else if (opts.include(entry, full)) {
      out.push(full);
    }
  }
  return out;
}
