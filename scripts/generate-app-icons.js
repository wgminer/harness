/**
 * Generate app icons from the draft-horse SVG marks.
 *
 * Source of truth (white fill, no background):
 *   resources/mark/draft-horse.svg        full harness, used at 64px and up
 *   resources/mark/draft-horse-small.svg  collar only, used at 32px and below
 *
 * Composites the mark onto a softly shaded white plate, then writes:
 *   - desktop: inset rounded plate → resources/icon.png (+ identical icon-dev.png for now)
 *     and src-tauri/icons/icon.* (+ identical icon-dev.* for now)
 *   - iOS: full-bleed plate → ios/.../AppIcon.appiconset/AppIcon-1024.png
 *   - iOS widget: mark only, transparent → ios/.../HorseMark.imageset/HorseMark.png
 *
 * Usage:  npm run icons
 * macOS:  also builds .icns via iconutil, each size rendered from its own drawing
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { Resvg } = require("@resvg/resvg-js");

const root = path.join(__dirname, "..");
const markPath = path.join(root, "resources", "mark", "draft-horse.svg");
const smallMarkPath = path.join(root, "resources", "mark", "draft-horse-small.svg");
/** Rendered pixel sizes at or below this use the small drawing. */
const SMALL_MAX = 32;
/** Plate and mark gradients, top to bottom. */
const PLATE_STOPS = ["#ffffff", "#d3d3d9"];
const MARK_STOPS = ["#2e2e33", "#050506"];

const MASTER = 1024;
const PNG_SIZES = [32, 128, 256, 512];
/** Transparent margin around the colored plate (matches prior icon-dev squircle). */
const PLATE_MARGIN = 100;
/** Corner radius of the plate on the 1024 canvas (Apple's pre-26 macOS icon grid: 824 plate, 185.4 radius; macOS 26 clips inside it). */
const PLATE_RADIUS = 185.4;

const iosAppIconPath = path.join(
  root,
  "ios",
  "HarnessMobile",
  "Assets.xcassets",
  "AppIcon.appiconset",
  "AppIcon-1024.png"
);

const iosWidgetMarkPath = path.join(
  root,
  "ios",
  "HarnessMobileRecordingLiveActivity",
  "Assets.xcassets",
  "HorseMark.imageset",
  "HorseMark.png"
);

function readMarkSvg(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing mark SVG: ${file}`);
  }
  return fs.readFileSync(file, "utf8");
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
 * Apple's continuous-corner rounded square (the macOS icon shape), as an SVG path.
 * A plain rx arc sticks out past the system mask at the corners.
 */
function squirclePath(x, y, size, r) {
  const n = (v) => v.toFixed(2);
  // One corner in local coords (corner at origin, running along +u then turning to +v).
  const corner = [
    [1.08849296, 0, 0.86840694, 0, 0.63149379, 0.07491139],
    [0.37282383, 0.16905956, 0.16905956, 0.37282383, 0.07491139, 0.63149379],
    [0, 0.86840694, 0, 1.08849296, 0, 1.528665],
  ];
  // Each corner: its position, the direction arriving along the edge (u) and leaving (v).
  const corners = [
    [x + size, y, -1, 0, 0, 1],
    [x + size, y + size, 0, -1, -1, 0],
    [x, y + size, 1, 0, 0, -1],
    [x, y, 0, 1, 1, 0],
  ];
  const pt = ([cx, cy, ux, uy, vx, vy], a, b) => `${n(cx + (ux * a + vx * b) * r)} ${n(cy + (uy * a + vy * b) * r)}`;
  let d = `M${n(x + 1.528665 * r)} ${n(y)}`;
  for (const c of corners) {
    d += ` L${pt(c, 1.528665, 0)}`;
    for (const [a1, b1, a2, b2, a3, b3] of corner) d += ` C${pt(c, a1, b1)} ${pt(c, a2, b2)} ${pt(c, a3, b3)}`;
  }
  return `${d} Z`;
}

/**
 * @param {string} markSvg
 * @param {{ fullBleed?: boolean, small?: boolean }} [opts]
 */
function compositeSvg(markSvg, opts = {}) {
  const inner = markInner(markSvg);
  const m = opts.fullBleed ? 0 : PLATE_MARGIN;
  const s = 1024 - 2 * m;
  const plateShape = opts.fullBleed
    ? `<rect width="1024" height="1024"`
    : `<path d="${squirclePath(m, m, s, PLATE_RADIUS)}"`;
  const place = `transform="translate(${m},${m}) scale(${s / 1024})"`;
  const defs = `<linearGradient id="plate" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${PLATE_STOPS[0]}"/><stop offset="1" stop-color="${PLATE_STOPS[1]}"/></linearGradient>`;
  const mask = `<mask id="markMask" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024">${inner}</mask>`;
  // Small sizes stay crisp: one flat mark color, no shadows.
  if (opts.small) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>${defs}${mask}</defs>
  ${plateShape} fill="url(#plate)"/>
  <g ${place}><rect width="1024" height="1024" fill="${MARK_STOPS[1]}" mask="url(#markMask)"/></g>
</svg>`;
  }
  // sRGB filter space: the default linearRGB bands the plate gradient at 8 bits.
  const shadow = (id, blur, dy, alpha) =>
    `<filter id="${id}" x="-20%" y="-20%" width="140%" height="150%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceAlpha" stdDeviation="${blur}"/><feOffset dy="${dy}"/><feComponentTransfer><feFuncA type="linear" slope="${alpha}"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
  // Transparent canvas; the plate is inset (macOS dock style). No drawn rim: macOS 26 re-masks every icon to
  // its own rounder shape and adds its own edge highlight, so a rim on this shape would be cut at the corners.
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    ${defs}
    <linearGradient id="markFill" gradientUnits="userSpaceOnUse" x1="0" y1="230" x2="0" y2="800"><stop offset="0" stop-color="${MARK_STOPS[0]}"/><stop offset="1" stop-color="${MARK_STOPS[1]}"/></linearGradient>
    ${shadow("plateShadow", 10, 10, 0.35)}
    ${mask}
  </defs>
  ${plateShape} fill="url(#plate)"${opts.fullBleed ? "" : ' filter="url(#plateShadow)"'}/>
  <g ${place}>
    <rect width="1024" height="1024" fill="#ffffff" opacity="0.9" mask="url(#markMask)" transform="translate(0,5)"/>
    <rect width="1024" height="1024" fill="url(#markFill)" mask="url(#markMask)"/>
  </g>
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

function buildIcns(renderAt, outIcns) {
  if (process.platform !== "darwin") {
    console.log(`  skip icns (not macOS): ${path.relative(root, outIcns)}`);
    return;
  }
  const iconset = outIcns.replace(/\.icns$/i, ".iconset");
  if (fs.existsSync(iconset)) fs.rmSync(iconset, { recursive: true });
  fs.mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}.png`), renderAt(size));
    fs.writeFileSync(path.join(iconset, `icon_${size}x${size}@2x.png`), renderAt(size * 2));
  }
  execSync(`iconutil -c icns "${iconset}" -o "${outIcns}"`, { stdio: "pipe" });
  fs.rmSync(iconset, { recursive: true });
  console.log(`  wrote ${path.relative(root, outIcns)}`);
}

function main() {
  const markSvg = readMarkSvg(markPath);
  const smallMarkSvg = readMarkSvg(smallMarkPath);
  console.log(`icons: mark ← ${path.relative(root, markPath)} (+ small ≤ ${SMALL_MAX}px)`);

  const masterSvg = compositeSvg(markSvg);
  const smallSvg = compositeSvg(smallMarkSvg, { small: true });
  /** Desktop icon at a pixel size, from the drawing meant for that size. */
  const renderAt = (size) => renderPng(size <= SMALL_MAX ? smallSvg : masterSvg, size);

  const resourcePng = path.join(root, "resources", "icon.png");
  const resourceDevPng = path.join(root, "resources", "icon-dev.png");
  const iconsPng = path.join(root, "src-tauri", "icons", "icon.png");
  const iconsDevPng = path.join(root, "src-tauri", "icons", "icon-dev.png");
  const iconsIcns = path.join(root, "src-tauri", "icons", "icon.icns");
  const iconsDevIcns = path.join(root, "src-tauri", "icons", "icon-dev.icns");

  writePng(resourcePng, renderAt(MASTER));
  copyFile(resourcePng, resourceDevPng);

  // Tauri PNG (512 master for icons/icon.png convention in this repo)
  const tauriPng = renderAt(512);
  writePng(iconsPng, tauriPng);
  writePng(iconsDevPng, tauriPng);

  // Size ladder referenced by tauri.conf.json bundle.icon
  for (const size of PNG_SIZES) {
    if (size === 256) {
      writePng(path.join(root, "src-tauri", "icons", "128x128@2x.png"), renderAt(256));
      continue;
    }
    if (size === 512) {
      // already wrote icons/icon.png at 512
      continue;
    }
    writePng(path.join(root, "src-tauri", "icons", `${size}x${size}.png`), renderAt(size));
  }
  // also 64 for completeness if present historically
  writePng(path.join(root, "src-tauri", "icons", "64x64.png"), renderAt(64));

  buildIcns(renderAt, iconsIcns);
  if (process.platform === "darwin") {
    copyFile(iconsIcns, iconsDevIcns);
  } else {
    console.log(`  skip icns (not macOS): ${path.relative(root, iconsDevIcns)}`);
  }

  // iOS: full-bleed plate (system applies the mask; no transparent margin)
  const iosSvg = compositeSvg(markSvg, { fullBleed: true });
  writePng(iosAppIconPath, renderPng(iosSvg, MASTER));

  // iOS widget: bare mark as a template image (the widget supplies color and background)
  writePng(iosWidgetMarkPath, renderPng(markSvg, 512));

  // Keep build/icon.icns in sync for the legacy make-icns consumers
  const buildIcnsPath = path.join(root, "build", "icon.icns");
  if (process.platform === "darwin") {
    fs.mkdirSync(path.dirname(buildIcnsPath), { recursive: true });
    copyFile(iconsIcns, buildIcnsPath);
  }

  console.log("icons: done");
}

main();
