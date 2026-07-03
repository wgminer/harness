#!/usr/bin/env node
/**
 * Unified dist runner for Harness (Tauri).
 *
 * Steps: icon -> speech-helper -> fn-monitor -> vite build -> tauri build
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
require("dotenv").config({ path: path.join(root, ".env") });

const args = process.argv.slice(2);
const isMac = args.includes("--mac") || process.platform === "darwin";
const replace = args.includes("--replace");
const quick = args.includes("--quick");
const publish = args.includes("--publish");

if (quick) {
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  process.env.HARNESS_SKIP_VERSION_BUMP = "1";
}

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

function syncTauriVersion(next) {
  const cargoPath = path.join(root, "src-tauri", "Cargo.toml");
  const confPath = path.join(root, "src-tauri", "tauri.conf.json");
  if (fs.existsSync(cargoPath)) {
    const cargo = fs.readFileSync(cargoPath, "utf8");
    fs.writeFileSync(
      cargoPath,
      cargo.replace(/^version = ".*"$/m, `version = "${next}"`)
    );
  }
  if (fs.existsSync(confPath)) {
    const conf = JSON.parse(fs.readFileSync(confPath, "utf8"));
    conf.version = next;
    fs.writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);
  }
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
  syncTauriVersion(next);

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
    `\n${color("cyan", makeBar(idx, total))} ${color("bold", `[${idx + 1}/${total}]`)} ${label} ${color("dim", `(total elapsed ${totalSoFar})`)}`
  );

  const heartbeat = setInterval(() => {
    const stepE = fmtDuration(Date.now() - stepStart);
    const totalE = fmtDuration(Date.now() - startedAt);
    console.log(color("dim", `  · ${label}: still running — step ${stepE}, total ${totalE}`));
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
    `${color("green", makeBar(idx + 1, total))} ${color("bold", `[${idx + 1}/${total}]`)} ${label} ${color("green", "done")} ${color("dim", `step ${stepE} · total ${totalE}`)}`
  );
}

function findBuiltApp() {
  const candidates = [
    path.join(root, "src-tauri", "target", "release", "bundle", "macos", "Harness.app"),
    path.join(root, "dist", "mac-arm64", "Harness.app"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function installToApplications(appPath) {
  const dest = "/Applications/Harness.app";
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(appPath, dest, { recursive: true });
  console.log(color("green", `  Installed ${appPath} → ${dest}`));
}

async function main() {
  const modeExtras = [replace && "replace", quick && "quick (unsigned)", publish && "publish"].filter(Boolean);
  console.log(
    color("bold", `\n▸ Harness dist (tauri${modeExtras.length ? ` + ${modeExtras.join(" + ")}` : ""})`)
  );
  if (quick) {
    console.log(color("yellow", "  quick: code signing disabled — for local testing only"));
  }

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
    console.log(`  ${color("cyan", "version")}: ${color("green", `v${cur}`)} ${color("dim", "(bump skipped)")}`);
  }

  const tauriCli = path.join(root, "node_modules", ".bin", "tauri");

  const steps = [
    {
      label: "icon:icns",
      run: () => runChild(process.execPath, [path.join(root, "build", "make-icns.js")]),
    },
    {
      label: "build:speech-helper",
      run: () => runChild("bash", [path.join(root, "scripts", "build-speech-helper.sh")]),
    },
    {
      label: "build:fn-monitor",
      run: () => runChild("bash", [path.join(root, "scripts", "build-fn-monitor.sh")]),
    },
    {
      label: "vite build",
      run: () => runChild("npm", ["run", "build:web"]),
    },
    {
      label: publish ? "tauri build + publish" : "tauri build",
      run: () => {
        const tauriArgs = ["build"];
        if (isMac) tauriArgs.push("--bundles", "dmg,app");
        return runChild(tauriCli, tauriArgs);
      },
    },
  ];

  const ctx = { timings: [] };
  for (let i = 0; i < steps.length; i += 1) {
    await runStep(ctx, i, steps.length, steps[i].label, steps[i].run);
  }

  if (replace) {
    const appPath = findBuiltApp();
    if (!appPath) throw new Error("Built Harness.app not found");
    installToApplications(appPath);
  }

  const builtApp = findBuiltApp();
  if (builtApp) {
    const { execSync } = require("child_process");
    const size = execSync(`du -sh "${builtApp}"`, { encoding: "utf8" }).trim();
    console.log(color("dim", `  artifact: ${builtApp} (${size.split("\t")[0]})`));
  }

  const totalE = fmtDuration(Date.now() - startedAt);
  console.log(color("green", `\n✓ dist finished in ${totalE}`));
}

if (require.main === module) {
  main().catch((err) => {
    const totalE = fmtDuration(Date.now() - startedAt);
    console.error(color("red", `\n✗ dist failed after ${totalE}: ${err?.message ?? err}`));
    process.exit(1);
  });
}

module.exports = { shouldBumpVersion, bumpPatchVersion, fmtDuration, makeBar };
