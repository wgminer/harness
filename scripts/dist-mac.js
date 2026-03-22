/**
 * Run electron-builder for macOS. Pass --replace to copy the built .app into /Applications
 * (removes any existing app with the same bundle name first).
 *
 * Prefer: npm run dist:mac:replace
 * Or: npm run dist:mac -- --replace
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const applications = "/Applications";

const rawArgs = process.argv.slice(2);
const replace = rawArgs.includes("--replace");
const builderArgs = rawArgs.filter((a) => a !== "--replace");

function findBuiltApp() {
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

function installToApplications(srcApp) {
  const name = path.basename(srcApp);
  const dest = path.join(applications, name);
  console.log(`Replacing ${dest} with ${srcApp}`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(srcApp, dest, { recursive: true });
  console.log(`Installed: ${dest}`);
}

const ebCli = require.resolve("electron-builder/cli");
const r = spawnSync(
  process.execPath,
  [ebCli, "--mac", ...builderArgs],
  { stdio: "inherit", cwd: root }
);

if (r.error) {
  console.error(r.error);
  process.exit(1);
}
if (r.status !== 0) {
  process.exit(r.status ?? 1);
}

if (replace) {
  const appPath = findBuiltApp();
  if (!appPath) {
    console.error(
      "Could not find a built .app under dist/mac-*. Run a full pack (not only --dir) or check the build output."
    );
    process.exit(1);
  }
  try {
    installToApplications(appPath);
  } catch (e) {
    console.error("Failed to copy to /Applications:", e.message);
    console.error("Quit Harness if it is running, then try again.");
    process.exit(1);
  }
}
