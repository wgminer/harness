#!/usr/bin/env node
/**
 * Flags hardcoded px values in renderer CSS that fall off the 4px grid
 * and unitless line-height ratios.
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CSS_DIR = join(__dirname, "..", "src", "renderer");
const ALLOWED = new Set([1, 2, 3, 6, 12, 13, 14, 16, 999, 9999]);
const SHADOW_OR_BLUR = /box-shadow|blur\(/;
const COMMENT = /^\s*\/\*/;
const COLOR_MIX = /color-mix\s*\(/i;
const VAR_USE = /var\(\s*(--[\w-]+)/g;
const VAR_DEF = /^\s*(--[\w-]+)\s*:/;

/** Renderer CSS must not use runtime color-mix (flat token model). */
export function auditColorMix(content, file) {
  const issues = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (COMMENT.test(lines[i])) continue;
    if (COLOR_MIX.test(lines[i])) {
      issues.push({ file, line: i + 1, value: "color-mix()" });
    }
  }
  return issues;
}

/** Collect --token definitions from any rule block in a stylesheet. */
export function parseCssVarDefinitions(content) {
  const defs = new Set();
  for (const line of content.split("\n")) {
    const m = line.match(VAR_DEF);
    if (m) defs.add(m[1]);
  }
  return defs;
}

export function buildKnownCssVarDefs(cssDir = CSS_DIR, extraTokens = []) {
  const defs = new Set();
  for (const file of readdirSync(cssDir).filter((f) => f.endsWith(".css"))) {
    const content = readFileSync(join(cssDir, file), "utf8");
    for (const name of parseCssVarDefinitions(content)) defs.add(name);
  }
  for (const t of extraTokens) defs.add(t);
  return defs;
}

/** Flag var(--token) uses with no definition in base.css :root or known theme token lists. */
export function auditUndefinedCssVars(content, file, knownDefs) {
  const issues = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    if (COMMENT.test(lineText)) continue;
    let m;
    VAR_USE.lastIndex = 0;
    while ((m = VAR_USE.exec(lineText))) {
      const name = m[1];
      if (!knownDefs.has(name)) {
        issues.push({ file, line: i + 1, value: `undefined var(${name})` });
      }
    }
  }
  return issues;
}

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

/** @deprecated Borders are allowed; kept for API compatibility with older audit callers. */
export function auditLayoutBorders() {
  return [];
}

export function auditCssFile(content, file, knownDefs) {
  return [
    ...auditPxValues(content, file),
    ...auditLineHeights(content, file),
    ...auditLayoutBorders(content, file),
    ...auditColorMix(content, file),
    ...(knownDefs ? auditUndefinedCssVars(content, file, knownDefs) : []),
  ];
}


export function runGridAudit(cssDir = CSS_DIR, knownDefs = null) {
  const files = readdirSync(cssDir).filter((f) => f.endsWith(".css"));
  const pxIssues = [];
  const lhIssues = [];
  const borderIssues = [];
  const colorMixIssues = [];
  const undefinedVarIssues = [];

  for (const file of files) {
    const content = readFileSync(join(cssDir, file), "utf8");
    pxIssues.push(...auditPxValues(content, file));
    lhIssues.push(...auditLineHeights(content, file));
    borderIssues.push(...auditLayoutBorders(content, file));
    colorMixIssues.push(...auditColorMix(content, file));
    if (knownDefs) {
      undefinedVarIssues.push(...auditUndefinedCssVars(content, file, knownDefs));
    }
  }

  return { files, pxIssues, lhIssues, borderIssues, colorMixIssues, undefinedVarIssues };
}

function main() {
  const knownDefs = buildKnownCssVarDefs(CSS_DIR);
  const { files, pxIssues, lhIssues, borderIssues, colorMixIssues, undefinedVarIssues } =
    runGridAudit(CSS_DIR, knownDefs);
  const totalIssues =
    pxIssues.length +
    lhIssues.length +
    borderIssues.length +
    colorMixIssues.length +
    undefinedVarIssues.length;

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
    console.error(`\ngrid-audit: ${borderIssues.length} unexpected border audit issue(s):\n`);
    for (const i of borderIssues) {
      console.error(`  ${i.file}:${i.line}  ${i.value}`);
    }
  }

  if (colorMixIssues.length > 0) {
    console.error(`\ngrid-audit: ${colorMixIssues.length} color-mix() call(s):\n`);
    for (const i of colorMixIssues) {
      console.error(`  ${i.file}:${i.line}  ${i.value}`);
    }
  }

  if (undefinedVarIssues.length > 0) {
    console.error(`\ngrid-audit: ${undefinedVarIssues.length} undefined CSS var(s):\n`);
    for (const i of undefinedVarIssues) {
      console.error(`  ${i.file}:${i.line}  ${i.value}`);
    }
  }

  process.exit(1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
