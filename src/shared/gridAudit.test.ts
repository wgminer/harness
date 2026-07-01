import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import {
  CSS_DIR,
  auditColorMix,
  auditPxValues,
  auditLineHeights,
  buildKnownCssVarDefs,
  runGridAudit,
} from "../../scripts/grid-audit.js";

describe("grid-audit", () => {
  it("renderer CSS has no color-mix() calls", () => {
    const { colorMixIssues } = runGridAudit();
    expect(colorMixIssues, formatIssues(colorMixIssues)).toEqual([]);
  });

  it("renderer CSS has no off-grid px or unitless line-heights", () => {
    const { pxIssues, lhIssues } = runGridAudit();
    expect(pxIssues, formatIssues(pxIssues)).toEqual([]);
    expect(lhIssues, formatIssues(lhIssues)).toEqual([]);
  });

  it("renderer CSS var() references are defined in bundled stylesheets", () => {
    const knownDefs = buildKnownCssVarDefs(CSS_DIR);
    const { undefinedVarIssues } = runGridAudit(CSS_DIR, knownDefs);
    expect(undefinedVarIssues, formatIssues(undefinedVarIssues)).toEqual([]);
  });

  it("base.css defines border color tokens", () => {
    const base = readFileSync(join(CSS_DIR, "base.css"), "utf8");
    expect(base).toContain("--border-edge:");
    expect(base).toContain("--border-input:");
    expect(base).toContain("--border-input-focus:");
  });

  it("auditPxValues skips box-shadow lines", () => {
    const sample = `.x { box-shadow: 0 3px 5px black; }`;
    expect(auditPxValues(sample, "sample.css")).toEqual([]);
  });

  it("auditColorMix flags color-mix usage", () => {
    const sample = `.x { color: color-mix(in srgb, red, blue); }`;
    expect(auditColorMix(sample, "sample.css")).toHaveLength(1);
  });

  it("auditLineHeights flags unitless ratios", () => {
    const sample = `.x { line-height: 1.5; }`;
    expect(auditLineHeights(sample, "sample.css")).toHaveLength(1);
  });

  it("scans every renderer stylesheet", () => {
    const cssFiles = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css"));
    expect(cssFiles.length).toBeGreaterThanOrEqual(8);
  });
});

function formatIssues(issues: { file: string; line: number; value: string }[]): string {
  if (issues.length === 0) return "";
  return issues.map((i) => `${i.file}:${i.line} ${i.value}`).join("\n");
}
