#!/usr/bin/env node
/**
 * Collect Tauri build artifacts into dist/ and publish a GitHub Release.
 * Called from scripts/release.js after build + verify.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");

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
    if (stderr) console.error(stderr);
    process.exit(result.status || 1);
  }
  return (result.stdout || "").trim();
}

function getGithubRepo() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const url = pkg.repository?.url || "";
  const match = url.match(/github\.com[/:](.+?)(?:\.git)?$/);
  return match ? match[1] : "wgminer/harness";
}

function findDmg(bundleRoot) {
  const dmgDir = path.join(bundleRoot, "dmg");
  if (!fs.existsSync(dmgDir)) return null;
  const names = fs.readdirSync(dmgDir).filter((f) => f.endsWith(".dmg"));
  return names.length ? path.join(dmgDir, names[0]) : null;
}

function findApp(bundleRoot) {
  const appPath = path.join(bundleRoot, "macos", "Harness.app");
  return fs.existsSync(appPath) ? appPath : null;
}

function findUpdaterArtifacts(bundleRoot) {
  const macosDir = path.join(bundleRoot, "macos");
  if (!fs.existsSync(macosDir)) return null;
  const tarGz = path.join(macosDir, "Harness.app.tar.gz");
  const sig = path.join(macosDir, "Harness.app.tar.gz.sig");
  if (!fs.existsSync(tarGz) || !fs.existsSync(sig)) return null;
  return { tarGz, sig };
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function collectReleaseAssets(version) {
  if (process.platform !== "darwin") {
    console.error("Release asset collection must run on macOS.");
    process.exit(1);
  }

  const bundleRoot = path.join(root, "src-tauri", "target", "release", "bundle");
  const distDir = path.join(root, "dist");
  const prefix = `harness-v${version}-mac`;
  const assets = [];

  const dmgSrc = findDmg(bundleRoot);
  if (!dmgSrc) {
    console.error(`No DMG found under ${path.join(bundleRoot, "dmg")}. Run npm run dist:mac first.`);
    process.exit(1);
  }

  const dmgDest = path.join(distDir, `${prefix}.dmg`);
  copyFile(dmgSrc, dmgDest);
  assets.push(dmgDest);

  const appPath = findApp(bundleRoot);
  if (!appPath) {
    console.error(`Harness.app not found under ${path.join(bundleRoot, "macos")}.`);
    process.exit(1);
  }

  const zipDest = path.join(distDir, `${prefix}.zip`);
  run("ditto", ["-c", "-k", "--keepParent", appPath, zipDest]);
  assets.push(zipDest);

  const updater = findUpdaterArtifacts(bundleRoot);
  let latestJsonPath = null;
  if (updater) {
    const tarDest = path.join(distDir, `${prefix}.app.tar.gz`);
    const sigDest = path.join(distDir, `${prefix}.app.tar.gz.sig`);
    copyFile(updater.tarGz, tarDest);
    copyFile(updater.sig, sigDest);
    assets.push(tarDest, sigDest);

    const repo = getGithubRepo();
    const tag = `v${version}`;
    const signature = fs.readFileSync(sigDest, "utf8").trim();
    const latestJson = {
      version,
      notes: `Harness v${version} for macOS.`,
      pub_date: new Date().toISOString(),
      platforms: {
        "darwin-aarch64": {
          url: `https://github.com/${repo}/releases/download/${tag}/${path.basename(tarDest)}`,
          signature,
        },
      },
    };
    latestJsonPath = path.join(distDir, "latest.json");
    fs.writeFileSync(latestJsonPath, `${JSON.stringify(latestJson, null, 2)}\n`);
    assets.push(latestJsonPath);
  } else {
    console.warn(
      "Updater artifacts not found (Harness.app.tar.gz + .sig). " +
        "Set TAURI_SIGNING_PRIVATE_KEY before building to enable in-app updates."
    );
  }

  return assets;
}

function releaseExists(repo, tag) {
  const result = spawnSync("gh", ["release", "view", tag, "--repo", repo], {
    encoding: "utf8",
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result.status === 0;
}

function publishGithubRelease(version) {
  const repo = getGithubRepo();
  const tag = `v${version}`;
  const title = version;
  const notes = `Harness v${version} for macOS.`;

  console.log(`Collecting release assets for ${tag}...`);
  const assets = collectReleaseAssets(version);
  for (const asset of assets) {
    console.log(`  ${path.relative(root, asset)}`);
  }

  console.log(`Publishing GitHub Release ${tag} to ${repo}...`);
  if (releaseExists(repo, tag)) {
    run("gh", ["release", "upload", tag, ...assets, "--repo", repo, "--clobber"]);
  } else {
    run("gh", [
      "release",
      "create",
      tag,
      ...assets,
      "--repo",
      repo,
      "--title",
      title,
      "--notes",
      notes,
    ]);
  }

  console.log(`Release published: https://github.com/${repo}/releases/tag/${tag}`);
}

if (require.main === module) {
  const version =
    process.argv[2] ||
    JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  publishGithubRelease(version);
}

module.exports = { collectReleaseAssets, publishGithubRelease, getGithubRepo };
