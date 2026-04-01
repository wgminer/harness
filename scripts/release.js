#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    if (stderr) {
      console.error(stderr);
    }
    process.exit(result.status || 1);
  }
  return (result.stdout || "").trim();
}

function getDistDmgs() {
  const distDir = path.resolve(process.cwd(), "dist");
  if (!fs.existsSync(distDir)) {
    return [];
  }

  return fs
    .readdirSync(distDir)
    .filter((name) => name.toLowerCase().endsWith(".dmg"))
    .map((name) => path.join(distDir, name));
}

function ensureCleanWorkingTree() {
  const porcelain = capture("git", ["status", "--porcelain"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (porcelain) {
    console.error("Working tree is not clean. Commit or stash changes before releasing.");
    process.exit(1);
  }
}

function main() {
  ensureCleanWorkingTree();
  const version = capture("node", ["-p", "require('./package.json').version"], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
  });

  console.log("Building macOS distribution (notarization required)...");
  run("npm", ["run", "dist:mac"], {
    env: { ...process.env, REQUIRE_NOTARIZE: "1" },
  });

  const dmgs = getDistDmgs();
  if (dmgs.length === 0) {
    console.error("No DMG file found in dist/ after build.");
    process.exit(1);
  }

  const sourceDmg = dmgs.sort((a, b) => {
    const aMtime = fs.statSync(a).mtimeMs;
    const bMtime = fs.statSync(b).mtimeMs;
    return bMtime - aMtime;
  })[0];

  const downloadsDir = path.resolve(process.cwd(), "site", "downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });
  const targetDmg = path.join(downloadsDir, "harness-latest.dmg");
  fs.copyFileSync(sourceDmg, targetDmg);

  console.log(`Copied ${path.basename(sourceDmg)} -> site/downloads/harness-latest.dmg`);
  console.log("Next steps:");
  console.log("  1) npm run verify:mac-trust");
  console.log("  2) git add site/downloads/harness-latest.dmg");
  console.log(`  3) git commit -m "release macOS dmg v${version}"`);
  console.log("  4) git push origin main");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
