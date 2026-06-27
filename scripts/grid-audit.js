#!/usr/bin/env node
/**
 * Flags hardcoded px values in renderer CSS that fall off the 4px grid,
 * unitless line-height ratios, and layout-affecting CSS borders (use --hairline-* shadows).
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CSS_DIR = join(__dirname, "..", "src", "renderer");
const ALLOWED = new Set([1, 2, 3, 6, 12, 13, 14, 16, 999, 9999]);
const SHADOW_OR_BLUR = /box-shadow|blur\(/;
const COMMENT = /^\s*\/\*/;
const BORDER_RADIUS = /border-radius/;
/** Match layout border declarations on a single line (not border-radius / border-box). */
const LAYOUT_BORDER_LINE =
  /\bborder(?:-(?:top|right|bottom|left))?\s*:\s*(?!none\b|0\b)[^;]*\b\d+px/i;
const BORDER_COLOR_LINE = /\bborder(?:-(?:top|right|bottom|left))?-color\s*:/i;
const BORDER_WIDTH_LINE = /\bborder-(?:top|right|bottom|left)-width\s*:\s*(?!0\b)\d/i;

function lineAt(content, index) {
  const lineStart = content.lastIndexOf("\n", index) + 1;
  const lineEnd = content.indexOf("\n", index);
  return content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
}

function lineNumber(content, index) {
  return content.slice(0, index).split("\n").length;
}

export function auditPxValues(content, file) {
  const issues = [];
  const re = /(?<![\w-])(\d+)px/g;
  let m;
  while ((m = re.exec(content))) {
    const n = Number(m[1]);
    const lineText = lineAt(content, m.index);
    if (COMMENT.test(lineText) || SHADOW_OR_BLUR.test(lineText)) continue;
    if (n % 4 !== 0 && !ALLOWED.has(n)) {
      issues.push({ file, line: lineNumber(content, m.index), value: `${n}px` });
    }
  }
  return issues;
}

export function auditLineHeights(content, file) {
  const issues = [];
  const lhRe = /line-height:\s*(\d+(?:\.\d+)?)(?![\w-])/g;
  let m;
  while ((m = lhRe.exec(content))) {
    const value = m[1];
    if (value === "0") continue;
    const lineText = lineAt(content, m.index);
    if (COMMENT.test(lineText)) continue;
    issues.push({ file, line: lineNumber(content, m.index), value: `line-height: ${value}` });
  }
  return issues;
}

/** Layout borders steal px under border-box; renderer uses --hairline-* box-shadow instead. */
export function auditLayoutBorders(content, file) {
  const issues = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (COMMENT.test(lineText) || BORDER_RADIUS.test(lineText)) continue;
    if (LAYOUT_BORDER_LINE.test(lineText)) {
      issues.push({ file, line: i + 1, value: `layout border: ${lineText.trim()}` });
      continue;
    }
    if (BORDER_COLOR_LINE.test(lineText)) {
      issues.push({ file, line: i + 1, value: `border-color: ${lineText.trim()}` });
      continue;
    }
    if (BORDER_WIDTH_LINE.test(lineText)) {
      issues.push({ file, line: i + 1, value: `border-width: ${lineText.trim()}` });
    }
  }
  return issues;
}

export function auditCssFile(content, file) {
  return [
    ...auditPxValues(content, file),
    ...auditLineHeights(content, file),
    ...auditLayoutBorders(content, file),
  ];
}

export function runGridAudit(cssDir = CSS_DIR) {
  const files = readdirSync(cssDir).filter((f) => f.endsWith(".css"));
  const pxIssues = [];
  const lhIssues = [];
  const borderIssues = [];

  for (const file of files) {
    const content = readFileSync(join(cssDir, file), "utf8");
    pxIssues.push(...auditPxValues(content, file));
    lhIssues.push(...auditLineHeights(content, file));
    borderIssues.push(...auditLayoutBorders(content, file));
  }

  return { files, pxIssues, lhIssues, borderIssues };
}

function main() {
  const { files, pxIssues, lhIssues, borderIssues } = runGridAudit();
  const totalIssues = pxIssues.length + lhIssues.length + borderIssues.length;

  if (totalIssues === 0) {
    console.log(`grid-audit: OK (${files.length} CSS files)`);
    process.exit(0);
  }

  if (pxIssues.length > 0) {
    console.error(`grid-audit: ${pxIssues.length} off-grid px value(s):\n`);
    for (const i of pxIssues) {
      console.error(`  ${i.file}:${i.line}  ${i.value}`);
    }
  }

  if (lhIssues.length > 0) {
    console.error(`\ngrid-audit: ${lhIssues.length} unitless line-height(s):\n`);
    for (const i of lhIssues) {
      console.error(`  ${i.file}:${i.line}  ${i.value}`);
    }
  }

  if (borderIssues.length > 0) {
    console.error(`\ngrid-audit: ${borderIssues.length} layout border(s) (use --hairline-* box-shadow):\n`);
    for (const i of borderIssues) {
      console.error(`  ${i.file}:${i.line}  ${i.value}`);
    }
  }

  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
