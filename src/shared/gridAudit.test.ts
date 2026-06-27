import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  CSS_DIR,
  auditLayoutBorders,
  auditPxValues,
  runGridAudit,
} from "../../scripts/grid-audit.js";

describe("grid-audit", () => {
  it("renderer CSS has no layout-affecting borders (use --hairline-* shadows)", () => {
    const { borderIssues } = runGridAudit();
    expect(borderIssues, formatIssues(borderIssues)).toEqual([]);
  });

  it("base.css defines hairline shadow tokens", () => {
    const base = readFileSync(join(CSS_DIR, "base.css"), "utf8");
    expect(base).toContain("--hairline-inset:");
    expect(base).toContain("--hairline-top:");
    expect(base).toContain("--hairline-bottom:");
    expect(base).toContain("--hairline-left-2-accent:");
  });

  it("auditLayoutBorders flags border shorthand but not border-radius", () => {
    const sample = `
      .a { border: 1px solid red; }
      .b { border-radius: 4px; }
      .c { border: none; }
    `;
    const issues = auditLayoutBorders(sample, "sample.css");
    expect(issues).toHaveLength(1);
    expect(issues[0].line).toBe(2);
  });

  it("auditPxValues skips box-shadow lines", () => {
    const sample = `.x { box-shadow: 0 3px 5px black; }`;
    expect(auditPxValues(sample, "sample.css")).toEqual([]);
  });

  it("scans every renderer stylesheet for layout borders", () => {
    const cssFiles = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css"));
    expect(cssFiles.length).toBeGreaterThanOrEqual(8);
    for (const file of cssFiles) {
      const content = readFileSync(join(CSS_DIR, file), "utf8");
      expect(auditLayoutBorders(content, file)).toEqual([]);
    }
  });
});

function formatIssues(issues: { file: string; line: number; value: string }[]): string {
  if (issues.length === 0) return "";
  return issues.map((i) => `${i.file}:${i.line} ${i.value}`).join("\n");
}
