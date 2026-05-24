#!/usr/bin/env node
/**
 * Flags hardcoded px values in renderer CSS that fall off the 4px grid,
 * and unitless line-height ratios (use --line-height-* tokens instead).
 * Allowed exceptions: 1px (hairlines), 2px (focus rings), 999px/9999px (pills / max-height hacks).
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_DIR = join(__dirname, "..", "src", "renderer");
const ALLOWED = new Set([1, 2, 3, 6, 12, 13, 14, 16, 999, 9999]);
const SHADOW_OR_BLUR = /box-shadow|blur\(/;
const COMMENT = /^\s*\/\*/;

const files = readdirSync(CSS_DIR).filter((f) => f.endsWith(".css"));
const issues = [];
const lhIssues = [];

for (const file of files) {
  const content = readFileSync(join(CSS_DIR, file), "utf8");
  const re = /(?<![\w-])(\d+)px/g;
  let m;
  while ((m = re.exec(content))) {
    const n = Number(m[1]);
    const lineStart = content.lastIndexOf("\n", m.index) + 1;
    const lineEnd = content.indexOf("\n", m.index);
    const lineText = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (COMMENT.test(lineText) || SHADOW_OR_BLUR.test(lineText)) continue;
    if (n % 4 !== 0 && !ALLOWED.has(n)) {
      const line = content.slice(0, m.index).split("\n").length;
      issues.push({ file, line, value: `${n}px` });
    }
  }

  const lhRe = /line-height:\s*(\d+(?:\.\d+)?)(?![\w-])/g;
  while ((m = lhRe.exec(content))) {
    const value = m[1];
    if (value === "0") continue;
    const lineStart = content.lastIndexOf("\n", m.index) + 1;
    const lineEnd = content.indexOf("\n", m.index);
    const lineText = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (COMMENT.test(lineText)) continue;
    const line = content.slice(0, m.index).split("\n").length;
    lhIssues.push({ file, line, value: `line-height: ${value}` });
  }
}

const totalIssues = issues.length + lhIssues.length;

if (totalIssues === 0) {
  console.log(`grid-audit: OK (${files.length} CSS files)`);
  process.exit(0);
}

if (issues.length > 0) {
  console.error(`grid-audit: ${issues.length} off-grid px value(s):\n`);
  for (const i of issues) {
    console.error(`  ${i.file}:${i.line}  ${i.value}`);
  }
}

if (lhIssues.length > 0) {
  console.error(`\ngrid-audit: ${lhIssues.length} unitless line-height(s):\n`);
  for (const i of lhIssues) {
    console.error(`  ${i.file}:${i.line}  ${i.value}`);
  }
}

process.exit(1);
