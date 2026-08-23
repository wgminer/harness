import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readBudgetLineCountSwift,
  walkFiles,
} from "./appSizeBudget";

const root = join(__dirname, "../..");
const appRoot = join(root, "ios/HarnessMobile");

/** Tight ceilings — ratchet after delete-loop sprints (baseline ~79 / 12,618 budget / 615). */
const MAX_FILES = 79;
const MAX_TOTAL_BUDGET_LINES = 13_100;
const MAX_FILE_BUDGET_LINES = 615;

type SwiftFileStat = {
  relPath: string;
  lines: number;
};

function collectStats(): SwiftFileStat[] {
  return walkFiles(appRoot, { include: (name) => name.endsWith(".swift") })
    .map((full) => ({
      relPath: relative(root, full),
      lines: readBudgetLineCountSwift(full),
    }))
    .sort((a, b) => b.lines - a.lines || a.relPath.localeCompare(b.relPath));
}

describe("iOS app size budget", () => {
  it("keeps HarnessMobile Swift files/budget-lines under ceilings", () => {
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
      `Swift file count ${fileCount} > ${MAX_FILES}. Largest:\n${top}`,
    ).toBeLessThanOrEqual(MAX_FILES);

    expect(
      totalLines,
      `Total budget lines ${totalLines} > ${MAX_TOTAL_BUDGET_LINES}. Largest:\n${top}`,
    ).toBeLessThanOrEqual(MAX_TOTAL_BUDGET_LINES);

    expect(
      largest?.lines ?? 0,
      `Largest file ${largest?.relPath} has ${largest?.lines} budget lines > ${MAX_FILE_BUDGET_LINES}`,
    ).toBeLessThanOrEqual(MAX_FILE_BUDGET_LINES);
  });
});
