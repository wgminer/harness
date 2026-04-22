/**
 * Generate build/icon.icns from resources/icon.png using macOS sips + iconutil.
 * Runs before `npm run build` on macOS (prebuild); no-op on other platforms.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

if (process.platform !== "darwin") {
  console.log(
    "icon:icns: skipped (macOS only); leave build/icon.icns as-is or generate on a Mac"
  );
  process.exit(0);
}

const root = path.join(__dirname, "..");
const srcPng = path.join(root, "resources", "icon.png");
const outIconset = path.join(root, "build", "icon.iconset");
const outIcns = path.join(root, "build", "icon.icns");

const sizes = [16, 32, 64, 128, 256, 512];

if (!fs.existsSync(srcPng)) {
  console.error("Missing resources/icon.png");
  process.exit(1);
}

// Remove previous iconset
if (fs.existsSync(outIconset)) {
  fs.rmSync(outIconset, { recursive: true });
}
fs.mkdirSync(outIconset, { recursive: true });

for (const size of sizes) {
  const name = `icon_${size}x${size}.png`;
  const name2x = `icon_${size}x${size}@2x.png`;
  const out = path.join(outIconset, name);
  const out2 = path.join(outIconset, name2x);
  execSync(`sips -z ${size} ${size} "${srcPng}" --out "${out}"`, { stdio: "inherit" });
  execSync(`sips -z ${size * 2} ${size * 2} "${srcPng}" --out "${out2}"`, { stdio: "inherit" });
}

execSync(`iconutil -c icns "${outIconset}" -o "${outIcns}"`, { stdio: "inherit" });
fs.rmSync(outIconset, { recursive: true });
console.log("Created", outIcns);
