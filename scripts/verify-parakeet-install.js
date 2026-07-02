/**
 * Verify a packaged Harness.app has Parakeet runtime but not bundled model weights.
 * Run after `npm run dist:mac` on macOS.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function findBuiltApp(root) {
  const dist = path.join(root, "dist");
  if (!fs.existsSync(dist)) return null;
  for (const sub of ["mac-universal", "mac-arm64", "mac"]) {
    const dir = path.join(dist, sub);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const apps = fs.readdirSync(dir).filter((f) => f.endsWith(".app"));
    if (apps.length > 0) return path.join(dir, apps[0]);
  }
  return null;
}

function main() {
  if (process.platform !== "darwin") {
    console.log("verify-parakeet-install: skipped (macOS only)");
    return;
  }

  const root = path.join(__dirname, "..");
  const arg = process.argv[2];
  const appPath = arg ? path.resolve(arg) : findBuiltApp(root);
  if (!appPath || !fs.existsSync(appPath)) {
    console.error("Could not find Harness.app. Run npm run dist:mac first.");
    process.exit(1);
  }

  const parakeetDir = path.join(appPath, "Contents", "Resources", "parakeet");
  const cli = path.join(parakeetDir, "parakeet");
  const axiom = path.join(parakeetDir, "libaxiom.0.dylib");
  const weights = path.join(parakeetDir, "model.safetensors");

  let failed = false;
  if (!fs.existsSync(cli)) {
    console.error("Missing bundled Parakeet CLI:", cli);
    failed = true;
  }
  if (!fs.existsSync(axiom)) {
    console.error("Missing bundled libaxiom:", axiom);
    failed = true;
  }
  if (fs.existsSync(weights)) {
    console.error("Bundled model weights should not be present:", weights);
    failed = true;
  }

  if (failed) process.exit(1);

  console.log("Parakeet bundle check passed:", appPath);
  console.log("  CLI + dylib present; model.safetensors not bundled (downloads on first use).");
  console.log("\nManual QA:");
  console.log("  1. Install the app, open Settings → Voice");
  console.log("  2. Download the model (~2.3 GB from Hugging Face)");
  console.log("  3. Confirm dictation works; model lives in ~/Library/Application Support/Harness/parakeet-model/");
}

main();
