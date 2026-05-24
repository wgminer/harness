#!/usr/bin/env node

const { spawnSync } = require("node:child_process");

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
    env: {
      ...process.env,
      REQUIRE_NOTARIZE: "1",
      // Releases manage their own version bumping; never let the dist runner
      // auto-bump the patch number underneath the release flow.
      HARNESS_SKIP_VERSION_BUMP: "1",
    },
  });

  console.log("Next steps:");
  console.log("  1) npm run verify:mac-trust");
  console.log(`  2) gh release create v${version} --title "v${version}" --notes "" (or update existing)`);
  console.log(`  3) Upload dist/harness-v${version}-mac.dmg to your artifact host (GitHub assets reject files >= 2 GiB)`);
  console.log("  4) git push origin main --tags");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
