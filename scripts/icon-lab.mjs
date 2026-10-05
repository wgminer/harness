/**
 * Icon lab: generate app-icon mark variants with the OpenAI Images API and
 * lay each one out at real icon sizes (512 → 16) for a legibility check.
 *
 * Output: resources/mark/_lab/<stamp>-<name>/  (gitignored)
 *   v1.png … vN.png   raw generations (white mark on black, 1024²)
 *   sheet.png         every variant on the dock plate at 256/128/64/32/16,
 *                     plus 32 and 16 blown up pixelated so blur is visible
 *   prompt.txt        the full prompt sent
 *
 * Usage:
 *   OPENAI_API_KEY=… node scripts/icon-lab.mjs --name bold-bridle \
 *     --prompt "horse head facing left, thick bridle" [--n 4] \
 *     [--ref resources/mark/horse-head-source.png] [--model gpt-image-1] \
 *     [--quality high] [--style icon|crest]
 *
 * With --ref the request goes to /images/edits (reference-guided); without,
 * to /images/generations. Re-sheet an existing folder with --sheet <dir>.
 *
 * Spend cap: every run is logged to _lab/spend.json (cost from the response's
 * token usage). A run whose worst-case estimate would push the total past the
 * budget (default $5, override with --budget or ICON_LAB_BUDGET_USD) is refused
 * before any request is sent. `--spend` prints the ledger total.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const labRoot = path.join(root, "resources", "mark", "_lab");

/** Constraints every variant must meet; the per-run prompt adds the idea. Pick with --style. */
const BASE_PROMPTS = {
  icon: `App icon mark for "Harness", a macOS dictation and chat app.
A single pure white (#FFFFFF) mark centered on a pure black (#000000) square background, filling about 70% of the frame.
Flat vector style: no gradients, no shading, no texture, no glow, no drop shadow, no 3D, no text, no letters, no border, no rounded plate.
Bold, uniform line weight and large simple shapes so it stays recognizable at 16x16 pixels. Few details; every detail must survive heavy downscaling.`,
  crest: `Brand mark for "Harness", a premium macOS dictation and chat app, in the tradition of equestrian luxury house marks (Hermès carriage, Ferrari horse, heraldic crests).
A single pure white (#FFFFFF) silhouette centered on a pure black (#000000) square background, filling about 80% of the frame.
Flat two-tone only: no gradients, no grey, no shading, no texture, no glow, no 3D, no text, no letters, no border, no frame.
Opinionated and rich in character: confident dynamic pose, crisp detailed contour with deliberate negative-space cuts (tack, straps, plumes, mane) that read as fine engraving at large size.`,
};

const spendPath = path.join(labRoot, "spend.json");
const DEFAULT_BUDGET_USD = 5;

/** USD per 1M tokens (gpt-image-1 list prices). */
const RATES = { textIn: 5, imageIn: 10, imageOut: 40 };
/** Output tokens per 1024x1024 image by quality. */
const OUTPUT_TOKENS = { low: 272, medium: 1056, high: 4160, auto: 4160 };
/** Generous upper bound for one reference image plus the prompt. */
const REF_INPUT_TOKENS = 1600;
const PROMPT_INPUT_TOKENS = 400;

const SHEET_SIZES = [256, 128, 64, 32, 16];
const PLATE_MARGIN = 100 / 1024;
const PLATE_RADIUS = 180 / 1024;

function parseArgs(argv) {
  const args = {
    n: 4,
    refs: [],
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
    quality: "high",
    style: "icon",
    budget: Number(process.env.ICON_LAB_BUDGET_USD) || DEFAULT_BUDGET_USD,
  };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    const val = argv[i + 1];
    switch (key) {
      case "--prompt": args.prompt = val; i++; break;
      case "--name": args.name = val; i++; break;
      case "--n": args.n = Number(val); i++; break;
      case "--ref": args.refs.push(val); i++; break;
      case "--model": args.model = val; i++; break;
      case "--quality": args.quality = val; i++; break;
      case "--sheet": args.sheet = val; i++; break;
      case "--style": args.style = val; i++; break;
      case "--budget": args.budget = Number(val); i++; break;
      case "--spend": args.spend = true; break;
      default: throw new Error(`Unknown argument: ${key}`);
    }
  }
  return args;
}

function loadApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  for (const file of [".env.local", ".env"]) {
    const p = path.join(root, file);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, "utf8").match(/^(?:VITE_)?OPENAI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  throw new Error("Set OPENAI_API_KEY (env or .env.local).");
}

function stamp() {
  const d = new Date();
  const pad = (v) => String(v).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function readLedger() {
  if (!fs.existsSync(spendPath)) return { totalUsd: 0, runs: [] };
  return JSON.parse(fs.readFileSync(spendPath, "utf8"));
}

function writeLedger(ledger) {
  fs.mkdirSync(labRoot, { recursive: true });
  fs.writeFileSync(spendPath, `${JSON.stringify(ledger, null, 2)}\n`);
}

function estimateUsd({ n, quality, refs }) {
  const out = (OUTPUT_TOKENS[quality] ?? OUTPUT_TOKENS.high) * n;
  const imageIn = refs.length * REF_INPUT_TOKENS;
  return (out * RATES.imageOut + imageIn * RATES.imageIn + PROMPT_INPUT_TOKENS * RATES.textIn) / 1e6;
}

function usageUsd(usage) {
  const details = usage.input_tokens_details ?? {};
  const imageIn = details.image_tokens ?? 0;
  const textIn = details.text_tokens ?? Math.max(0, (usage.input_tokens ?? 0) - imageIn);
  return (textIn * RATES.textIn + imageIn * RATES.imageIn + (usage.output_tokens ?? 0) * RATES.imageOut) / 1e6;
}

async function requestImages({ apiKey, model, prompt, n, quality, refs }) {
  let res;
  if (refs.length) {
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", prompt);
    form.append("n", String(n));
    form.append("size", "1024x1024");
    form.append("quality", quality);
    for (const ref of refs) {
      const buf = fs.readFileSync(path.resolve(root, ref));
      form.append("image[]", new Blob([buf], { type: "image/png" }), path.basename(ref));
    }
    res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } else {
    res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt, n, size: "1024x1024", quality, background: "opaque" }),
    });
  }
  const body = await res.json();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${body?.error?.message ?? JSON.stringify(body)}`);
  return { images: body.data.map((d) => Buffer.from(d.b64_json, "base64")), usage: body.usage };
}

function dataUri(buf) {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** The generated square on the inset rounded plate, rendered at `size`. */
function renderIcon(png, size) {
  const m = PLATE_MARGIN * 1024;
  const s = 1024 - 2 * m;
  const r = PLATE_RADIUS * 1024;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs><clipPath id="p"><rect x="${m}" y="${m}" width="${s}" height="${s}" rx="${r}"/></clipPath></defs>
  <image href="${dataUri(png)}" x="${m}" y="${m}" width="${s}" height="${s}" clip-path="url(#p)"/>
</svg>`;
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
}

function buildSheet(variants) {
  const gap = 24;
  const zoom = 128;
  const rowH = 256 + gap;
  const labelW = 60;
  const cols = [...SHEET_SIZES, "z32", "z16"];
  const colW = cols.map((c) => (typeof c === "number" ? c : zoom));
  const width = labelW + colW.reduce((a, b) => a + b + gap, 0) + gap;
  const height = variants.length * rowH + gap + 24;
  const parts = [];
  cols.forEach((c, i) => {
    const x = labelW + colW.slice(0, i).reduce((a, b) => a + b + gap, 0);
    const label = typeof c === "number" ? `${c}` : `${c.slice(1)} @8x`;
    parts.push(`<text x="${x}" y="20" fill="#888" font-family="Helvetica" font-size="14">${label}</text>`);
  });
  variants.forEach(({ label, png }, row) => {
    const y = 32 + row * rowH;
    parts.push(`<text x="12" y="${y + 24}" fill="#333" font-family="Helvetica" font-size="18">${label}</text>`);
    cols.forEach((c, i) => {
      const x = labelW + colW.slice(0, i).reduce((a, b) => a + b + gap, 0);
      if (typeof c === "number") {
        parts.push(`<image href="${dataUri(renderIcon(png, c))}" x="${x}" y="${y}" width="${c}" height="${c}"/>`);
      } else {
        const small = renderIcon(png, Number(c.slice(1)));
        parts.push(
          `<image href="${dataUri(small)}" x="${x}" y="${y}" width="${zoom}" height="${zoom}" image-rendering="optimizeSpeed"/>`
        );
      }
    });
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#e9e7e2"/>
  ${parts.join("\n  ")}
</svg>`;
  return new Resvg(svg, { font: { loadSystemFonts: true } }).render().asPng();
}

function sheetFolder(dir) {
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^v\d+\.png$/.test(f))
    .sort((a, b) => parseInt(a.slice(1)) - parseInt(b.slice(1)));
  const variants = files.map((f) => ({ label: f.replace(".png", ""), png: fs.readFileSync(path.join(dir, f)) }));
  fs.writeFileSync(path.join(dir, "sheet.png"), buildSheet(variants));
  return path.join(dir, "sheet.png");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.sheet) {
    console.log(sheetFolder(path.resolve(root, args.sheet)));
    return;
  }
  const ledger = readLedger();
  if (args.spend) {
    console.log(`$${ledger.totalUsd.toFixed(2)} of $${args.budget.toFixed(2)} spent across ${ledger.runs.length} runs`);
    return;
  }
  if (!args.prompt) throw new Error("--prompt is required");
  const estimate = estimateUsd(args);
  if (ledger.totalUsd + estimate > args.budget) {
    throw new Error(
      `Budget: $${ledger.totalUsd.toFixed(2)} spent + ~$${estimate.toFixed(2)} for this run would exceed $${args.budget.toFixed(2)}.`
    );
  }
  const apiKey = loadApiKey();
  const base = BASE_PROMPTS[args.style];
  if (!base) throw new Error(`Unknown --style ${args.style} (${Object.keys(BASE_PROMPTS).join(", ")})`);
  const prompt = `${base}\n\n${args.prompt}`;
  const dir = path.join(labRoot, `${stamp()}-${args.name ?? "run"}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "prompt.txt"),
    `model: ${args.model}\nrefs: ${args.refs.join(", ") || "(none)"}\n\n${prompt}\n`
  );

  const { images, usage } = await requestImages({ apiKey, prompt, ...args });
  const usd = usage ? usageUsd(usage) : estimate;
  // Re-read so concurrent runs don't overwrite each other's entries.
  const latest = readLedger();
  latest.runs.push({ dir: path.basename(dir), usd: Number(usd.toFixed(4)), at: new Date().toISOString() });
  latest.totalUsd = latest.runs.reduce((sum, run) => sum + run.usd, 0);
  writeLedger(latest);
  images.forEach((buf, i) => fs.writeFileSync(path.join(dir, `v${i + 1}.png`), buf));
  console.log(sheetFolder(dir));
  console.log(`run $${usd.toFixed(2)} · total $${latest.totalUsd.toFixed(2)} of $${args.budget.toFixed(2)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
