#!/usr/bin/env python3
"""
One-shot: re-trace resources/mark/horse-head-source.png (cream horse) → resources/mark/horse-head.svg

Requires: Pillow, potrace (brew install potrace)

Normal icon workflow does NOT need this — edit the SVG (or keep the committed
trace) and run `npm run icons`. Use this only when re-deriving the outline
from a new painted master.
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "resources" / "mark" / "horse-head-source.png"
OUT = ROOT / "resources" / "mark" / "horse-head.svg"


def largest_component(mask_u8: "Image.Image") -> Image.Image:
    import numpy as np

    m = np.array(mask_u8) > 127
    h, w = m.shape
    visited = np.zeros_like(m, dtype=bool)
    best_cells: list[tuple[int, int]] = []
    for y in range(h):
        for x in range(w):
            if not m[y, x] or visited[y, x]:
                continue
            stack = [(y, x)]
            visited[y, x] = True
            cells: list[tuple[int, int]] = []
            while stack:
                cy, cx = stack.pop()
                cells.append((cy, cx))
                for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < h and 0 <= nx < w and m[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
            if len(cells) > len(best_cells):
                best_cells = cells
    out = np.zeros((h, w), dtype=np.uint8)
    for y, x in best_cells:
        out[y, x] = 255
    return Image.fromarray(out, mode="L")


def main() -> int:
    if not SRC.exists():
        print(f"missing {SRC}", file=sys.stderr)
        return 1
    if subprocess.call(["which", "potrace"], stdout=subprocess.DEVNULL) != 0:
        print("potrace not found — brew install potrace", file=sys.stderr)
        return 1

    im = Image.open(SRC).convert("RGBA")
    arr = __import__("numpy").array(im)
    rgb = arr[:, :, :3].astype("int16")
    a = arr[:, :, 3]
    bright = rgb.sum(axis=2)
    mask = Image.fromarray(((a > 200) & (bright > 380)).astype("uint8") * 255, mode="L")

    # Bridge black harness straps so we get one outer silhouette (White Pony).
    closed = mask
    for _ in range(8):
        closed = closed.filter(ImageFilter.MaxFilter(5))
    for _ in range(8):
        closed = closed.filter(ImageFilter.MinFilter(5))

    sil = largest_component(closed)
    sil = sil.filter(ImageFilter.GaussianBlur(radius=1.2))
    sil = sil.point(lambda p: 255 if p > 128 else 0)

    W, H = sil.size
    bbox = sil.getbbox()
    assert bbox
    pad = 40
    x0, y0, x1, y1 = (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(W, bbox[2] + pad),
        min(H, bbox[3] + pad),
    )
    cw, ch = x1 - x0, y1 - y0
    horse_on_white = ImageOps.invert(sil.crop((x0, y0, x1, y1)))

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        bmp = tmp_path / "horse.bmp"
        raw_svg = tmp_path / "horse-raw.svg"
        horse_on_white.convert("1").save(bmp)
        subprocess.check_call(
            [
                "potrace",
                str(bmp),
                "-s",
                "-o",
                str(raw_svg),
                "--flat",
                "--opttolerance",
                "0.35",
                "--turdsize",
                "80",
                "--alphamax",
                "0.9",
                "--tight",
            ]
        )
        raw = raw_svg.read_text()

    g = re.search(r'<g transform="([^"]+)"[^>]*>\s*<path d="([^"]+)"', raw, re.S)
    if not g:
        print("potrace SVG missing path", file=sys.stderr)
        return 1
    transform, d = g.group(1), g.group(2)
    vb = re.search(r'viewBox="([^"]+)"', raw)
    assert vb
    vbw, vbh = map(float, vb.group(1).split()[2:])
    # ~14px stroke on the 1024 canvas after potrace scale(0.1) + fit-to-bbox
    stroke_path = (26 / 0.82) / (0.1 * (cw / vbw))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    # Mark fills the 1024 artboard; generate-app-icons.js draws the inset colored plate.
    OUT.write_text(
        f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" fill="none">
  <!--
    Harness mark — White Pony–style outline of the horse head.
    Source of truth for dist/dev app icons (see scripts/generate-app-icons.js).
    Regenerate from resources/mark/horse-head-source.png via: npm run icons:trace
  -->
  <g data-mark-scale="0.82" transform="translate(512,512) scale(0.82) translate(-512,-512)">
    <g transform="translate({x0},{y0}) scale({cw / vbw:.6f},{ch / vbh:.6f})">
      <g transform="{transform}">
        <path
          d="{d}"
          fill="none"
          stroke="#ffffff"
          stroke-width="{stroke_path:.2f}"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      </g>
    </g>
  </g>
</svg>
'''
    )
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
