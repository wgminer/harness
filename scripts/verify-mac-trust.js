/**
 * Verify a packaged Harness.app is signed, passes Gatekeeper assessment, and has a stapled notarization ticket.
 * Run after `npm run dist:mac` on macOS. Optional: pass path to .app as first argument.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function findBuiltApp(root) {
  const candidates = [
    path.join(root, "src-tauri", "target", "release", "bundle", "macos", "Harness.app"),
    path.join(root, "dist", "mac-universal", "Harness.app"),
    path.join(root, "dist", "mac-arm64", "Harness.app"),
    path.join(root, "dist", "mac", "Harness.app"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  const dist = path.join(root, "dist");
  if (!fs.existsSync(dist)) return null;
  for (const sub of ["mac-universal", "mac-arm64", "mac"]) {
    const dir = path.join(dist, sub);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    const apps = fs.readdirSync(dir).filter((f) => f.endsWith(".app"));
    if (apps.length > 0) {
      return path.join(dir, apps[0]);
    }
  }
  return null;
}

function runStep(label, command, args, appPath) {
  console.log(`\n— ${label}`);
  const r = spawnSync(command, args, {
    stdio: "inherit",
    cwd: path.join(__dirname, ".."),
  });
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(`\n${label} failed for: ${appPath}`);
    process.exit(r.status ?? 1);
  }
}

function main() {
  if (process.platform !== "darwin") {
    console.error("verify:mac-trust must run on macOS.");
    process.exit(1);
  }

  const root = path.join(__dirname, "..");
  const arg = process.argv[2];
  let appPath = arg ? path.resolve(arg) : findBuiltApp(root);

  if (!appPath || !fs.existsSync(appPath)) {
    console.error(
      "Could not find Harness.app. Run npm run dist:mac first, or pass the path:\n  npm run verify:mac-trust -- /path/to/Harness.app"
    );
    process.exit(1);
  }

  if (!appPath.endsWith(".app")) {
    console.error("Path must end with .app (verify the bundle, not the DMG).");
    process.exit(1);
  }

  console.log(`Verifying: ${appPath}`);

  runStep(
    "codesign verify (deep, strict)",
    "codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    appPath
  );

  runStep(
    "Gatekeeper assessment (execute)",
    "spctl",
    ["--assess", "--type", "execute", "--verbose=4", appPath],
    appPath
  );

  runStep(
    "stapler validate (notarization ticket)",
    "xcrun",
    ["stapler", "validate", appPath],
    appPath
  );

  console.log("\nAll checks passed. Safe to distribute this build (DMG/ZIP contain this app).");
}

main();
