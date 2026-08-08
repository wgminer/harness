/**
 * Generate dist/dev app icons from the White Pony–style SVG mark.
 *
 * Source of truth: resources/mark/horse-head.svg (white stroke, no background)
 *
 *   dist → black ground  (#000000)  → resources/icon.png + src-tauri/icons/icon.*
 *   dev  → blue ground   (#0000FF)  → resources/icon-dev.png + src-tauri/icons/icon-dev.*
 *
 * Usage:  npm run icons
 * macOS:  also builds .icns via sips + iconutil
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Resvg } = require("@resvg/resvg-js");

const root = path.join(__dirname, "..");
const markPath = path.join(root, "resources", "mark", "horse-head.svg");

/** @type {{ id: string, bg: string, resourcePng: string, iconsPng: string, iconsIcns: string }} */
const variants = [
  {
    id: "dist",
    bg: "#000000",
    resourcePng: path.join(root, "resources", "icon.png"),
    iconsPng: path.join(root, "src-tauri", "icons", "icon.png"),
    iconsIcns: path.join(root, "src-tauri", "icons", "icon.icns"),
  },
  {
    id: "dev",
    bg: "#0000FF",
    resourcePng: path.join(root, "resources", "icon-dev.png"),
    iconsPng: path.join(root, "src-tauri", "icons", "icon-dev.png"),
    iconsIcns: path.join(root, "src-tauri", "icons", "icon-dev.icns"),
  },
];

const MASTER = 1024;
const PNG_SIZES = [32, 128, 256, 512];

function readMarkSvg() {
  if (!fs.existsSync(markPath)) {
    throw new Error(`Missing mark SVG: ${markPath}`);
  }
  return fs.readFileSync(markPath, "utf8");
}

/** Strip xml/svg chrome so the mark can be nested inside a compositing SVG. */
function markInner(markSvg) {
  return markSvg
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .replace(/<svg[^>]*>/i, "")
    .replace(/<\/svg>/i, "")
    .trim();
}

function compositeSvg(markSvg, bgHex, size) {
  const inner = markInner(markSvg);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${bgHex}"/>
  ${inner}
</svg>`;
}

function renderPng(svg, size) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    background: "transparent",
  });
  return resvg.render().asPng();
}

function writePng(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  console.log(`  wrote ${path.relative(root, filePath)} (${bytes.length} bytes)`);
}

function buildIcns(srcPng, outIcns) {
  if (process.platform !== "darwin") {
    console.log(`  skip icns (not macOS): ${path.relative(root, outIcns)}`);
    return;
  }
  const iconset = outIcns.replace(/\.icns$/i, ".iconset");
  if (fs.existsSync(iconset)) fs.rmSync(iconset, { recursive: true });
  fs.mkdirSync(iconset, { recursive: true });
  const sizes = [16, 32, 64, 128, 256, 512];
  for (const size of sizes) {
    const name = `icon_${size}x${size}.png`;
    const name2x = `icon_${size}x${size}@2x.png`;
    execSync(`sips -z ${size} ${size} "${srcPng}" --out "${path.join(iconset, name)}"`, {
      stdio: "pipe",
    });
    execSync(
      `sips -z ${size * 2} ${size * 2} "${srcPng}" --out "${path.join(iconset, name2x)}"`,
      { stdio: "pipe" }
    );
  }
  execSync(`iconutil -c icns "${iconset}" -o "${outIcns}"`, { stdio: "pipe" });
  fs.rmSync(iconset, { recursive: true });
  console.log(`  wrote ${path.relative(root, outIcns)}`);
}

function main() {
  const markSvg = readMarkSvg();
  console.log(`icons: mark ← ${path.relative(root, markPath)}`);

  for (const v of variants) {
    console.log(`icons: ${v.id} (bg ${v.bg})`);
    const masterSvg = compositeSvg(markSvg, v.bg, MASTER);
    const masterPng = renderPng(masterSvg, MASTER);
    writePng(v.resourcePng, masterPng);

    // Tauri PNG (512 master for icons/icon.png convention in this repo)
    writePng(v.iconsPng, renderPng(masterSvg, 512));

    if (v.id === "dist") {
      // Size ladder referenced by tauri.conf.json bundle.icon
      for (const size of PNG_SIZES) {
        const name = size === 256 ? "128x128@2x.png" : `${size}x${size}.png`;
        // 128@2x is 256; skip duplicate 256 filename
        if (size === 256) {
          writePng(path.join(root, "src-tauri", "icons", "128x128@2x.png"), renderPng(masterSvg, 256));
          continue;
        }
        if (size === 512) {
          // already wrote icons/icon.png at 512
          continue;
        }
        writePng(path.join(root, "src-tauri", "icons", name), renderPng(masterSvg, size));
      }
      // also 64 for completeness if present historically
      writePng(path.join(root, "src-tauri", "icons", "64x64.png"), renderPng(masterSvg, 64));
    }

    buildIcns(v.resourcePng, v.iconsIcns);
  }

  // Keep build/icon.icns in sync for the legacy make-icns consumers
  const buildIcnsPath = path.join(root, "build", "icon.icns");
  if (process.platform === "darwin") {
    fs.mkdirSync(path.dirname(buildIcnsPath), { recursive: true });
    fs.copyFileSync(path.join(root, "src-tauri", "icons", "icon.icns"), buildIcnsPath);
    console.log(`  wrote ${path.relative(root, buildIcnsPath)} (copy)`);
  }

  console.log("icons: done");
}

main();
