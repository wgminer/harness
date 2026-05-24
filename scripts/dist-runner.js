#!/usr/bin/env node
/**
 * Unified dist runner for Harness.
 *
 * Responsibilities:
 *   1. Auto-bump the patch version in package.json (and package-lock.json) on every run.
 *      - Opt out with `HARNESS_SKIP_VERSION_BUMP=1` (release.js also sets `REQUIRE_NOTARIZE=1`,
 *        which is treated as an implicit opt-out so release builds keep the existing version).
 *      - Only edits package.json / package-lock.json; never runs git commit or git tag.
 *   2. Run the full dist pipeline as discrete, timed steps so you get progress feedback:
 *      icon -> parakeet -> fn-monitor -> electron-vite build -> electron-builder (+ optional /Applications install)
 *   3. Print a step counter, a simple ASCII progress bar, a per-step duration, and a running
 *      total elapsed time. Long-running steps emit a periodic "still running" heartbeat so it
 *      never looks frozen.
 *
 * Usage:
 *   node scripts/dist-runner.js                 # default cross-platform dist
 *   node scripts/dist-runner.js --mac           # mac dmg/zip via scripts/dist-mac.js
 *   node scripts/dist-runner.js --mac --replace # also install the built .app into /Applications
 *
 * Env flags:
 *   HARNESS_SKIP_VERSION_BUMP=1   skip the auto patch bump for this run
 *   REQUIRE_NOTARIZE=1            implies skip-bump (set by scripts/release.js)
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const args = process.argv.slice(2);
const isMac = args.includes("--mac");
const replace = args.includes("--replace");

const startedAt = Date.now();
const HEARTBEAT_MS = 15_000;

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function color(name, s) {
  if (!process.stdout.isTTY) return String(s);
  return `${COLORS[name] || ""}${s}${COLORS.reset}`;
}

function fmtDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, "0")}m${String(s).padStart(2, "0")}s`;
  if (m > 0) return `${m}m${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

function makeBar(done, total, width = 24) {
  const ratio = total === 0 ? 1 : Math.min(1, Math.max(0, done / total));
  const filled = Math.round(ratio * width);
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function shouldBumpVersion() {
  const skip = process.env.HARNESS_SKIP_VERSION_BUMP;
  if (skip === "1" || skip === "true") return false;
  const requireNotarize = process.env.REQUIRE_NOTARIZE;
  if (requireNotarize === "1" || requireNotarize === "true") return false;
  return true;
}

function bumpPatchVersion() {
  const pkgPath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const cur = String(pkg.version || "0.0.0");
  const m = cur.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!m) {
    console.warn(color("yellow", `  version: unable to parse "${cur}"; skipping bump`));
    return { from: cur, to: cur, bumped: false };
  }
  const next = `${m[1]}.${m[2]}.${Number(m[3]) + 1}${m[4]}`;
  pkg.version = next;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (lock.version) lock.version = next;
      if (lock.packages && lock.packages[""] && lock.packages[""].version) {
        lock.packages[""].version = next;
      }
      fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    } catch (e) {
      console.warn(color("yellow", `  version: could not patch package-lock.json (${e.message})`));
    }
  }
  return { from: cur, to: next, bumped: true };
}

function runChild(cmd, argv, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, {
      stdio: "inherit",
      cwd: root,
      env: process.env,
      ...opts,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`${cmd} killed by ${signal}`));
      else if (code === 0) resolve();
      else reject(new Error(`${cmd} ${argv.join(" ")} exited with code ${code}`));
    });
  });
}

async function runStep(ctx, idx, total, label, fn) {
  const stepStart = Date.now();
  const totalSoFar = fmtDuration(stepStart - startedAt);
  console.log(
    `\n${color("cyan", makeBar(idx, total))} ${color(
      "bold",
      `[${idx + 1}/${total}]`
    )} ${label} ${color("dim", `(total elapsed ${totalSoFar})`)}`
  );

  const heartbeat = setInterval(() => {
    const stepE = fmtDuration(Date.now() - stepStart);
    const totalE = fmtDuration(Date.now() - startedAt);
    console.log(
      color("dim", `  · ${label}: still running — step ${stepE}, total ${totalE}`)
    );
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    await fn();
  } finally {
    clearInterval(heartbeat);
  }

  const stepE = fmtDuration(Date.now() - stepStart);
  const totalE = fmtDuration(Date.now() - startedAt);
  ctx.timings.push({ label, ms: Date.now() - stepStart });
  console.log(
    `${color("green", makeBar(idx + 1, total))} ${color(
      "bold",
      `[${idx + 1}/${total}]`
    )} ${label} ${color("green", "done")} ${color("dim", `step ${stepE} · total ${totalE}`)}`
  );
}

async function main() {
  const mode = isMac ? "mac" : "default";
  console.log(color("bold", `\n▸ Harness dist (${mode}${replace ? " + replace" : ""})`));

  let versionInfo;
  if (shouldBumpVersion()) {
    versionInfo = bumpPatchVersion();
    if (versionInfo.bumped) {
      console.log(
        `  ${color("cyan", "version")}: ${color("dim", versionInfo.from)} → ${color("green", `v${versionInfo.to}`)}`
      );
    }
  } else {
    const cur = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
    versionInfo = { from: cur, to: cur, bumped: false };
    console.log(
      `  ${color("cyan", "version")}: ${color("green", `v${cur}`)} ${color("dim", "(bump skipped)")}`
    );
  }

  // electron-vite's package "exports" doesn't expose bin/, so resolve via package.json's
  // "bin" field manually (avoids the ERR_PACKAGE_PATH_NOT_EXPORTED error from require.resolve).
  const evPkg = require("electron-vite/package.json");
  const evBin = typeof evPkg.bin === "string" ? evPkg.bin : evPkg.bin?.["electron-vite"];
  if (!evBin) throw new Error("could not locate electron-vite bin in node_modules");
  const electronViteCli = path.join(
    path.dirname(require.resolve("electron-vite/package.json")),
    evBin
  );
  const electronBuilderCli = require.resolve("electron-builder/cli");

  /** Each step is { label, run: () => Promise<void> } */
  const steps = [
    {
      label: "icon:icns",
      run: () => runChild(process.execPath, [path.join(root, "build", "make-icns.js")]),
    },
    {
      label: "parakeet:setup",
      run: () => runChild(process.execPath, [path.join(root, "scripts", "setup-parakeet.js")]),
    },
    {
      label: "build:fn-monitor",
      run: () => runChild("bash", [path.join(root, "scripts", "build-fn-monitor.sh")]),
    },
    {
      label: "electron-vite build",
      run: () => runChild(process.execPath, [electronViteCli, "build"]),
    },
  ];

  if (isMac) {
    const distMacArgs = [path.join(root, "scripts", "dist-mac.js")];
    if (replace) distMacArgs.push("--replace");
    steps.push({
      label: replace
        ? "electron-builder (mac) + install to /Applications"
        : "electron-builder (mac dmg/zip)",
      run: () => runChild(process.execPath, distMacArgs),
    });
  } else {
    steps.push({
      label: "electron-builder",
      run: () => runChild(process.execPath, [electronBuilderCli]),
    });
  }

  const ctx = { timings: [] };
  for (let i = 0; i < steps.length; i += 1) {
    await runStep(ctx, i, steps.length, steps[i].label, steps[i].run);
  }

  const totalE = fmtDuration(Date.now() - startedAt);
  console.log(color("green", `\n✓ dist finished in ${totalE}`));

  // Per-step breakdown
  console.log(color("bold", "  breakdown:"));
  for (const t of ctx.timings) {
    console.log(`    ${String(t.label).padEnd(48)} ${color("dim", fmtDuration(t.ms))}`);
  }

  if (versionInfo.bumped) {
    console.log(
      color(
        "dim",
        `  package.json now at v${versionInfo.to} (no git commit/tag was created)`
      )
    );
  } else {
    console.log(color("dim", `  package.json version: v${versionInfo.to}`));
  }
}

if (require.main === module) {
  main().catch((err) => {
    const totalE = fmtDuration(Date.now() - startedAt);
    console.error(
      color("red", `\n✗ dist failed after ${totalE}: ${err?.message ?? err}`)
    );
    process.exit(1);
  });
}

module.exports = {
  shouldBumpVersion,
  bumpPatchVersion,
  fmtDuration,
  makeBar,
};
