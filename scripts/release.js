#!/usr/bin/env node
/**
 * One-command release: `npm run release`.
 *
 * Works from whatever state the repo is in:
 *   1. Preflight (main branch, GH_TOKEN, gh CLI, catch up with origin).
 *   2. Pick the version: if v<current> is already published on GitHub, bump the
 *      patch; otherwise ship <current> as-is. That makes a failed run resumable
 *      (re-run ships the same version) and a manual minor/major bump just works.
 *   3. `npm test`, then commit everything (pending work + version files).
 *   4. Signed + notarized build, Gatekeeper check.
 *   5. Tag, push main + tag, publish the GitHub Release + latest.json.
 *
 * Installed apps pick the release up through the in-app updater.
 *
 * `--dry-run` builds and verifies the current tree only: no bump, commit,
 * push, or publish.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

// Load repo-root .env (GH_TOKEN, APPLE_SIGNING_IDENTITY, APPLE_*, etc.) before any env checks.
require("dotenv").config({ path: path.join(root, ".env") });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function fail(message) {
  console.error(`\nRelease stopped: ${message}`);
  process.exit(1);
}

function run(command, argv, options = {}) {
  const result = spawnSync(command, argv, { stdio: "inherit", cwd: root, ...options });
  if (result.status !== 0) fail(`\`${command} ${argv.join(" ")}\` failed.`);
}

/** Run quietly; returns { ok, out }. */
function probe(command, argv) {
  const result = spawnSync(command, argv, {
    encoding: "utf8",
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ok: result.status === 0, out: (result.stdout || "").trim() };
}

function readVersion() {
  return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
}

function githubRepo() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const match = (pkg.repository?.url || "").match(/github\.com[/:](.+?)(?:\.git)?$/);
  return match ? match[1] : "wgminer/harness";
}

function releasePublished(tag) {
  return probe("gh", ["release", "view", tag, "--repo", githubRepo()]).ok;
}

function preflight() {
  const branch = probe("git", ["rev-parse", "--abbrev-ref", "HEAD"]).out;
  if (branch !== "main") fail(`on branch "${branch}"; releases ship from main.`);

  if (!probe("gh", ["--version"]).ok) fail("the GitHub CLI (gh) is not installed.");
  if (!process.env.GH_TOKEN && !process.env.GITHUB_TOKEN) {
    fail("GH_TOKEN (or GITHUB_TOKEN) is missing. Set it in .env.");
  }

  run("git", ["fetch", "origin", "--tags", "--force"]);
  const behind = Number(probe("git", ["rev-list", "--count", "HEAD..origin/main"]).out || 0);
  if (behind > 0) {
    console.log(`Pulling ${behind} commit(s) from origin/main...`);
    const pulled = spawnSync("git", ["pull", "--rebase", "--autostash", "origin", "main"], {
      stdio: "inherit",
      cwd: root,
    });
    if (pulled.status !== 0) {
      spawnSync("git", ["rebase", "--abort"], { cwd: root, stdio: "ignore" });
      fail("could not rebase onto origin/main cleanly. Resolve it by hand, then re-run.");
    }
  }
}

/** Bump only when the current version already shipped. */
function chooseVersion() {
  const { bumpPatchVersion, syncTauriVersion } = require("./dist-runner");
  const current = readVersion();
  if (!releasePublished(`v${current}`)) {
    // Covers a hand-edited package.json (minor/major bump) as well as a retry.
    syncTauriVersion(current);
    console.log(`v${current} is not published yet; releasing it as-is.`);
    return current;
  }
  const { to } = bumpPatchVersion();
  if (to === current) fail(`could not bump version "${current}".`);
  console.log(`v${current} is already published; bumped to v${to}.`);
  return to;
}

function commitEverything(version) {
  run("git", ["add", "-A"]);
  if (probe("git", ["diff", "--cached", "--quiet"]).ok) {
    console.log("Nothing to commit.");
    return;
  }
  run("git", ["commit", "-q", "-m", `Release v${version}`]);
  console.log(`Committed pending work as "Release v${version}".`);
}

function build() {
  // Prevent Tauri signer from prompting on a TTY when the key has no password.
  const env = { ...process.env, REQUIRE_NOTARIZE: "1", HARNESS_SKIP_VERSION_BUMP: "1" };
  if (!("TAURI_SIGNING_PRIVATE_KEY_PASSWORD" in env)) env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
  run(process.execPath, [path.join(root, "scripts", "dist-runner.js"), "--mac"], { env });

  console.log("Verifying notarization and Gatekeeper trust...");
  run("npm", ["run", "verify:mac-trust"]);
}

/**
 * Point the tag at HEAD and push. A tag without a published release is a
 * leftover from a failed run, so it is safe to move.
 */
function tagAndPush(tag) {
  run("git", ["tag", "-f", tag]);
  run("git", ["push", "origin", "main"]);
  run("git", ["push", "--force", "origin", `refs/tags/${tag}`]);
}

function main() {
  if (dryRun) {
    console.log(`Dry run: building v${readVersion()} from the current tree (no bump/commit/publish).`);
    build();
    console.log("Dry run complete.");
    return;
  }

  preflight();
  const version = chooseVersion();
  const tag = `v${version}`;

  console.log("Running tests...");
  run("npm", ["test", "--silent"]);
  commitEverything(version);

  console.log(`Building Harness ${tag}...`);
  build();

  tagAndPush(tag);

  const { publishGithubRelease } = require("./publish-github-release");
  publishGithubRelease(version);

  console.log(`\nRelease ${tag} is live. Installed apps will show the Update button within 30 minutes.`);
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
