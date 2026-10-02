#!/usr/bin/env node
/**
 * Render the demo scenes (src/renderer/demo/scenes.ts) into site assets.
 * Stills become PNGs; clips are stepped frame by frame on a paused page clock
 * (timers, rAF, and CSS animations all advance together), then encoded to MP4.
 *
 * Usage:  npm run capture:site                      every scene
 *         npm run capture:site -- --only dictation  one scene
 *         npm run capture:site -- --gif             also write a GIF per clip
 *         npm run capture:site -- --out /tmp/shots
 * Preview scenes live with `npm run demo`.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = argValue("--only");
const outDir = path.resolve(argValue("--out") ?? path.join(root, "site", "assets"));
const FPS = Number(argValue("--fps") ?? 30);
const wantGif = args.includes("--gif");

/** Keep in step with DEMO_NOW in src/renderer/demo/demoSeed.ts. */
const DEMO_NOW = new Date("2026-09-14T09:41:00").getTime();
const SCALE = 2;
/** Encoded clip width; 1.5x the window keeps text crisp on retina at a sane file size. */
const CLIP_WIDTH_FACTOR = 1.5;
const MAX_CLIP_MS = 60_000;

/** Let React's MessageChannel-scheduled work commit after timers fire. */
const settle = (page) =>
  page.evaluate(async () => {
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => resolve();
        channel.port2.postMessage(0);
      });
    }
  });

async function openScene(browser, baseUrl, scene) {
  const context = await browser.newContext({
    viewport: scene.viewport,
    deviceScaleFactor: SCALE,
    colorScheme: "dark",
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error(`[${scene.id}] ${err.message}`));
  await page.clock.install({ time: DEMO_NOW - 1000 });
  await page.clock.pauseAt(DEMO_NOW);
  await page.goto(`${baseUrl}demo.html?scene=${encodeURIComponent(scene.id)}&record`, { waitUntil: "load" });
  // Page time is paused; step it while modules load and the app boots.
  for (let i = 0; i < 400; i++) {
    if (await page.evaluate(() => window.__demo?.ready === true)) return { context, page };
    await page.clock.runFor(50);
    await page.waitForTimeout(15);
  }
  throw new Error(`${scene.id}: demo never became ready`);
}

async function sceneError(page) {
  return page.evaluate(() => window.__demo?.error ?? null);
}

async function renderStill(browser, baseUrl, scene) {
  const { context, page } = await openScene(browser, baseUrl, scene);
  await page.evaluate(() => window.__demo.start());
  for (let i = 0; i < 400 && !(await page.evaluate(() => window.__demo.done)); i++) {
    await page.clock.runFor(50);
    await settle(page);
  }
  await page.clock.runFor(800);
  await settle(page);
  await page.evaluate(() => window.__demo.syncAnimations());
  const error = await sceneError(page);
  if (error) throw new Error(`${scene.id}: ${error}`);
  const dest = path.join(outDir, `${scene.id}.png`);
  await page.screenshot({ path: dest });
  await context.close();
  console.log(`Wrote ${path.relative(root, dest)}`);
}

function ffmpeg(ffArgs) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...ffArgs], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`ffmpeg failed (${ffArgs.join(" ")})`);
}

async function renderClip(browser, baseUrl, scene) {
  const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), `harness-${scene.id}-`));
  const { context, page } = await openScene(browser, baseUrl, scene);
  const frameMs = 1000 / FPS;
  await page.evaluate(() => window.__demo.start());
  let count = 0;
  for (; count < (MAX_CLIP_MS / 1000) * FPS; count++) {
    await page.clock.runFor(frameMs);
    await settle(page);
    const { done, cursor } = await page.evaluate(() => {
      window.__demo.syncAnimations();
      return { done: window.__demo.done, cursor: window.__demo.cursor() };
    });
    // The real pointer follows the drawn one, so hover styles match.
    if (cursor) await page.mouse.move(cursor.x, cursor.y);
    await page.screenshot({ path: path.join(frameDir, `f${String(count).padStart(5, "0")}.png`) });
    if (done) break;
    if (count % FPS === 0) process.stdout.write(`\r${scene.id}: ${Math.round(count / FPS)}s`);
  }
  process.stdout.write("\n");
  const error = await sceneError(page);
  await context.close();
  if (error) throw new Error(`${scene.id}: ${error}`);

  const width = Math.round(scene.viewport.width * CLIP_WIDTH_FACTOR);
  const frames = path.join(frameDir, "f%05d.png");
  const mp4 = path.join(outDir, `${scene.id}.mp4`);
  ffmpeg([
    "-framerate", String(FPS), "-i", frames,
    "-vf", `scale=${width}:-2:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-movflags", "+faststart", "-an", mp4,
  ]);
  const poster = path.join(outDir, `${scene.id}-poster.jpg`);
  ffmpeg(["-i", path.join(frameDir, "f00000.png"), "-vf", `scale=${width}:-2:flags=lanczos`, "-q:v", "3", poster]);
  console.log(`Wrote ${path.relative(root, mp4)} (${count + 1} frames) and ${path.basename(poster)}`);
  if (wantGif) {
    const gif = path.join(outDir, `${scene.id}.gif`);
    ffmpeg([
      "-framerate", String(FPS), "-i", frames,
      "-vf", "fps=15,scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
      gif,
    ]);
    console.log(`Wrote ${path.relative(root, gif)}`);
  }
  fs.rmSync(frameDir, { recursive: true, force: true });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const server = await createServer({
    configFile: path.join(root, "vite.config.ts"),
    server: { port: 5199, strictPort: false },
    logLevel: "warn",
  });
  await server.listen();
  const baseUrl = server.resolvedUrls.local[0];
  const browser = await chromium.launch();
  try {
    const probe = await browser.newPage();
    await probe.goto(`${baseUrl}demo.html?record`, { waitUntil: "load" });
    await probe.waitForFunction(() => window.__demo?.scenes);
    const scenes = await probe.evaluate(() => window.__demo.scenes);
    await probe.close();
    const selected = scenes.filter((s) => !only || s.id === only);
    if (selected.length === 0) throw new Error(`No scene named ${only}. Scenes: ${scenes.map((s) => s.id).join(", ")}`);
    for (const scene of selected) {
      if (scene.kind === "still") await renderStill(browser, baseUrl, scene);
      else await renderClip(browser, baseUrl, scene);
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
