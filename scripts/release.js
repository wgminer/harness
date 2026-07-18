#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");

// Load repo-root .env (GH_TOKEN, APPLE_SIGNING_IDENTITY, APPLE_*, etc.) before any env checks.
require("dotenv").config({ path: path.join(root, ".env") });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noTag = args.includes("--no-tag");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    cwd: root,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function capture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: root,
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

function ensureCleanWorkingTree() {
  const porcelain = capture("git", ["status", "--porcelain"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (porcelain) {
    console.error("Working tree is not clean. Commit or stash changes before releasing.");
    process.exit(1);
  }
}

function ensureGhToken() {
  if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) return;
  console.error(
    "GH_TOKEN (or GITHUB_TOKEN) is required to publish releases. Set it in your environment or .env."
  );
  process.exit(1);
}

function tagExists(tag) {
  const result = spawnSync("git", ["rev-parse", "--verify", `refs/tags/${tag}`], {
    encoding: "utf8",
    cwd: root,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0;
}

function main() {
  ensureCleanWorkingTree();

  // Prevent Tauri signer from prompting on a TTY when the key has no password.
  if (!("TAURI_SIGNING_PRIVATE_KEY_PASSWORD" in process.env)) {
    process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
  }

  if (!dryRun) {
    ensureGhToken();
  }

  // Real releases bump package.json + Cargo.toml + tauri.conf.json first.
  // Dry-run keeps the current version (for verifying the pipeline).
  const distArgs = ["--mac"];
  if (!dryRun) {
    distArgs.push("--bump");
  }

  console.log(
    `Releasing Harness${dryRun ? " (dry run — no bump/publish/tag)" : " (bump + publish)"}...`
  );

  run(process.execPath, [path.join(root, "scripts", "dist-runner.js"), ...distArgs], {
    env: (() => {
      const env = { ...process.env, REQUIRE_NOTARIZE: "1" };
      delete env.HARNESS_SKIP_VERSION_BUMP;
      return env;
    })(),
  });

  const version = capture("node", ["-p", "require('./package.json').version"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tag = `v${version}`;
  console.log(`Built Harness ${tag}${dryRun ? " (dry run)" : ""}.`);

  console.log("Verifying notarization and Gatekeeper trust...");
  run("npm", ["run", "verify:mac-trust"]);

  if (dryRun) {
    console.log("Dry run complete. Built and verified; skipped GitHub publish and git tag.");
    return;
  }

  const { publishGithubRelease } = require("./publish-github-release");
  publishGithubRelease(version);

  if (noTag) {
    console.log("Skipped git tag push (--no-tag).");
    return;
  }

  if (!tagExists(tag)) {
    run("git", ["tag", tag]);
  } else {
    console.log(`Git tag ${tag} already exists locally.`);
  }

  run("git", ["push", "origin", tag]);
  run("git", ["push", "origin", "main"]);
  console.log(`Release ${tag} is live. Installed apps will see the Update button on next launch.`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
