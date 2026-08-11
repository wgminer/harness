/**
 * Generate app icons from the White Pony–style SVG mark.
 *
 * Source of truth: resources/mark/horse-head.svg (white stroke, no background)
 *
 * Composites the mark onto black, then writes:
 *   - desktop: inset rounded plate → resources/icon.png (+ identical icon-dev.png for now)
 *     and src-tauri/icons/icon.* (+ identical icon-dev.* for now)
 *   - iOS: full-bleed black → ios/.../AppIcon.appiconset/AppIcon-1024.png
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
const BG = "#000000";

const MASTER = 1024;
const PNG_SIZES = [32, 128, 256, 512];
/** Transparent margin around the colored plate (matches prior icon-dev squircle). */
const PLATE_MARGIN = 100;
/** Corner radius of the plate on the 1024 canvas (~22% of plate edge). */
const PLATE_RADIUS = 180;

const iosAppIconPath = path.join(
  root,
  "ios",
  "HarnessMobile",
  "Assets.xcassets",
  "AppIcon.appiconset",
  "AppIcon-1024.png"
);

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

/**
 * @param {string} markSvg
 * @param {string} bgHex
 * @param {number} size
 * @param {{ fullBleed?: boolean }} [opts]
 */
function compositeSvg(markSvg, bgHex, size, opts = {}) {
  const inner = markInner(markSvg);
  const plate = opts.fullBleed
    ? `<rect width="1024" height="1024" fill="${bgHex}"/>`
    : (() => {
        const m = PLATE_MARGIN;
        const s = 1024 - 2 * m;
        const r = PLATE_RADIUS;
        // Transparent canvas; colored plate is inset (macOS dock style).
        return `<rect x="${m}" y="${m}" width="${s}" height="${s}" rx="${r}" ry="${r}" fill="${bgHex}"/>`;
      })();
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  ${plate}
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

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`  wrote ${path.relative(root, dest)} (copy)`);
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
  console.log(`icons: mark ← ${path.relative(root, markPath)} (bg ${BG})`);

  const masterSvg = compositeSvg(markSvg, BG, MASTER);
  const masterPng = renderPng(masterSvg, MASTER);

  const resourcePng = path.join(root, "resources", "icon.png");
  const resourceDevPng = path.join(root, "resources", "icon-dev.png");
  const iconsPng = path.join(root, "src-tauri", "icons", "icon.png");
  const iconsDevPng = path.join(root, "src-tauri", "icons", "icon-dev.png");
  const iconsIcns = path.join(root, "src-tauri", "icons", "icon.icns");
  const iconsDevIcns = path.join(root, "src-tauri", "icons", "icon-dev.icns");

  writePng(resourcePng, masterPng);
  copyFile(resourcePng, resourceDevPng);

  // Tauri PNG (512 master for icons/icon.png convention in this repo)
  const tauriPng = renderPng(masterSvg, 512);
  writePng(iconsPng, tauriPng);
  writePng(iconsDevPng, tauriPng);

  // Size ladder referenced by tauri.conf.json bundle.icon
  for (const size of PNG_SIZES) {
    if (size === 256) {
      writePng(path.join(root, "src-tauri", "icons", "128x128@2x.png"), renderPng(masterSvg, 256));
      continue;
    }
    if (size === 512) {
      // already wrote icons/icon.png at 512
      continue;
    }
    writePng(path.join(root, "src-tauri", "icons", `${size}x${size}.png`), renderPng(masterSvg, size));
  }
  // also 64 for completeness if present historically
  writePng(path.join(root, "src-tauri", "icons", "64x64.png"), renderPng(masterSvg, 64));

  buildIcns(resourcePng, iconsIcns);
  if (process.platform === "darwin") {
    copyFile(iconsIcns, iconsDevIcns);
  } else {
    console.log(`  skip icns (not macOS): ${path.relative(root, iconsDevIcns)}`);
  }

  // iOS: full-bleed black (system applies the mask; no transparent margin)
  const iosSvg = compositeSvg(markSvg, BG, MASTER, { fullBleed: true });
  writePng(iosAppIconPath, renderPng(iosSvg, MASTER));

  // Keep build/icon.icns in sync for the legacy make-icns consumers
  const buildIcnsPath = path.join(root, "build", "icon.icns");
  if (process.platform === "darwin") {
    fs.mkdirSync(path.dirname(buildIcnsPath), { recursive: true });
    copyFile(iconsIcns, buildIcnsPath);
  }

  console.log("icons: done");
}

main();
