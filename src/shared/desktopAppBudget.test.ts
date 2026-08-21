import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { readPhysicalLineCount, walkFiles } from "./appSizeBudget";

const root = join(__dirname, "../..");
const rendererRoot = join(root, "src/renderer");

/** Tight ceilings — ratchet after delete-loop sprints (baseline ~80 / 15,940 / 1,410). */
const MAX_FILES = 83;
const MAX_TOTAL_LINES = 16_850;
const MAX_FILE_LINES = 1_410;

type RendererFileStat = {
  relPath: string;
  lines: number;
};

function isBudgetedRendererSource(name: string): boolean {
  if (!/\.(ts|tsx)$/.test(name)) return false;
  if (/\.test\./.test(name)) return false;
  if (/\.stories\./.test(name)) return false;
  if (name === "storyHelpers.ts" || name === "storyHelpers.tsx") return false;
  return true;
}

function collectStats(): RendererFileStat[] {
  return walkFiles(rendererRoot, { include: (name) => isBudgetedRendererSource(name) })
    .map((full) => ({
      relPath: relative(root, full),
      lines: readPhysicalLineCount(full),
    }))
    .sort((a, b) => b.lines - a.lines || a.relPath.localeCompare(b.relPath));
}

describe("desktop renderer size budget", () => {
  it("keeps src/renderer TS/TSX (ex tests/stories) under ceilings", () => {
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
      `Renderer file count ${fileCount} > ${MAX_FILES}. Largest:\n${top}`,
    ).toBeLessThanOrEqual(MAX_FILES);

    expect(
      totalLines,
      `Total lines ${totalLines} > ${MAX_TOTAL_LINES}. Largest:\n${top}`,
    ).toBeLessThanOrEqual(MAX_TOTAL_LINES);

    expect(
      largest?.lines ?? 0,
      `Largest file ${largest?.relPath} has ${largest?.lines} lines > ${MAX_FILE_LINES}`,
    ).toBeLessThanOrEqual(MAX_FILE_LINES);
  });
});
