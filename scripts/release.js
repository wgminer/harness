#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const { createInterface } = require("node:readline/promises");
const { stdin, stdout } = require("node:process");

const RELEASE_TYPES = ["patch", "minor", "major"];

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

function bumpVersion(version, releaseType) {
  const parts = version.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    throw new Error(`Unsupported version format: ${version}`);
  }

  let [major, minor, patch] = parts;
  if (releaseType === "major") {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (releaseType === "minor") {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  return `${major}.${minor}.${patch}`;
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

async function chooseReleaseType(rl) {
  const answer = (
    await rl.question("Release type (patch/minor/major): ")
  ).trim().toLowerCase();
  if (!RELEASE_TYPES.includes(answer)) {
    console.error("Invalid release type. Choose patch, minor, or major.");
    process.exit(1);
  }
  return answer;
}

async function confirm(rl, message) {
  const answer = (await rl.question(`${message} `)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function main() {
  ensureCleanWorkingTree();

  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const currentVersion = capture("node", ["-p", "require('./package.json').version"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
    });
    const releaseType = await chooseReleaseType(rl);
    const nextVersion = bumpVersion(currentVersion, releaseType);
    const nextTag = `v${nextVersion}`;

    console.log(`Current version: ${currentVersion}`);
    console.log(`Next version: ${nextVersion}`);

    const proceed = await confirm(rl, "Continue? (y/N)");
    if (!proceed) {
      console.log("Release cancelled.");
      process.exit(0);
    }

    console.log("Building macOS distribution...");
    run("npm", ["run", "dist:mac"]);

    console.log(`Bumping version (${releaseType}) and creating tag ${nextTag}...`);
    run("npm", ["version", releaseType]);

    console.log("Pushing commit and tag...");
    run("git", ["push", "origin", "HEAD"]);
    run("git", ["push", "origin", nextTag]);

    console.log(`Release ${nextTag} pushed. GitHub Actions will publish artifacts and update the download site.`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
