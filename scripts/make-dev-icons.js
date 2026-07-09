/**
 * Generate resources/icon-dev.png and icon-tray-dev.png from production icons.
 * Adds an orange dev band and warm tint so dev builds are visually distinct in the Dock.
 * Tray icons get a warm tint + small corner dot at native 18×18 (bands look wrong at menu bar size).
 * Requires ffmpeg (optional — skips if missing).
 */
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const resources = path.join(root, "resources");

function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

function makeDevIcon(srcName, outName) {
  const src = path.join(resources, srcName);
  const out = path.join(resources, outName);
  if (!fs.existsSync(src)) {
    console.error(`make-dev-icons: missing ${src}`);
    process.exit(1);
  }
  const filter = [
    "scale=512:512",
    "drawbox=x=0:y=0:w=iw:h=48:color=0xFF6B00@0.95:t=fill",
    "drawbox=x=0:y=ih-12:w=iw:h=12:color=0xFF6B00@0.95:t=fill",
    "colorbalance=rs=0.15:gs=0.05:bs=-0.1",
  ].join(",");
  execSync(
    `ffmpeg -y -loglevel error -i "${src}" -vf "${filter}" -update 1 "${out}"`,
    { stdio: "inherit" },
  );
  console.log("Created", out);
}

/** Menu bar icons are 18×18 — orange bands from the Dock treatment look wrong at that size. */
function makeDevTrayIcon() {
  const src = path.join(resources, "icon-tray@2x.png");
  const out = path.join(resources, "icon-tray-dev.png");
  if (!fs.existsSync(src)) {
    console.error(`make-dev-icons: missing ${src}`);
    process.exit(1);
  }
  const filter = [
    "scale=18:18:flags=lanczos",
    "colorbalance=rs=0.35:gs=0.12:bs=-0.2",
    "drawbox=x=13:y=13:w=4:h=4:color=0xFF6B00@1:t=fill",
  ].join(",");
  execSync(
    `ffmpeg -y -loglevel error -i "${src}" -vf "${filter}" -update 1 "${out}"`,
    { stdio: "inherit" },
  );
  console.log("Created", out);
}

if (!hasFfmpeg()) {
  console.log("make-dev-icons: skipped (ffmpeg not found)");
  process.exit(0);
}

makeDevIcon("icon.png", "icon-dev.png");
makeDevTrayIcon();
