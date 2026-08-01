import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");
const appRoot = join(root, "ios/HarnessMobile");

/** Tight ceilings — ratchet after delete-loop sprints (baseline ~76 / 12,146 / 581). */
const MAX_FILES = 78;
const MAX_TOTAL_LINES = 12_300;
const MAX_FILE_LINES = 600;

type SwiftFileStat = {
  relPath: string;
  lines: number;
};

function listSwiftFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === ".DS_Store") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSwiftFiles(full));
    } else if (entry.endsWith(".swift")) {
      out.push(full);
    }
  }
  return out;
}

/** Physical line count matching `wc -l` (counts newlines). */
function lineCount(path: string): number {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) n++;
  }
  // wc -l does not count a final line without a trailing newline as an extra line
  // when the file ends with \n; when it doesn't end with \n, last partial line counts.
  if (!text.endsWith("\n")) n++;
  return n;
}

function collectStats(): SwiftFileStat[] {
  return listSwiftFiles(appRoot)
    .map((full) => ({
      relPath: relative(root, full),
      lines: lineCount(full),
    }))
    .sort((a, b) => b.lines - a.lines || a.relPath.localeCompare(b.relPath));
}

describe("iOS app size budget", () => {
  it("keeps HarnessMobile Swift files/lines under ceilings", () => {
    const stats = collectStats();
    const fileCount = stats.length;
    const totalLines = stats.reduce((sum, s) => sum + s.lines, 0);
    const largest = stats[0];

    const top = stats
      .slice(0, 5)
      .map((s) => `  ${s.lines}\t${s.relPath}`)
      .join("\n");

    expect(
      fileCount,
      `Swift file count ${fileCount} > ${MAX_FILES}. Largest:\n${top}`
    ).toBeLessThanOrEqual(MAX_FILES);

    expect(
      totalLines,
      `Total lines ${totalLines} > ${MAX_TOTAL_LINES}. Largest:\n${top}`
    ).toBeLessThanOrEqual(MAX_TOTAL_LINES);

    expect(
      largest?.lines ?? 0,
      `Largest file ${largest?.relPath} has ${largest?.lines} lines > ${MAX_FILE_LINES}`
    ).toBeLessThanOrEqual(MAX_FILE_LINES);
  });
});
