#!/usr/bin/env node
/**
 * Capture Storybook UI/* gallery stories to PNGs for agent visual inspection.
 *
 * Uses port 6006 when Storybook is already running; otherwise builds static
 * Storybook into tmp/storybook-static and serves it temporarily.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "tmp/ui-shots/storybook");
const STATIC_DIR = path.join(ROOT, "tmp/storybook-static");
const STORYBOOK_PORT = Number(process.env.HARNESS_STORYBOOK_PORT ?? 6006);
const VIEWPORT = { width: 1280, height: 900 };
const BG = "#111111";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchIndex(baseUrl) {
  const res = await fetch(`${baseUrl}/index.json`);
  if (!res.ok) {
    throw new Error(`index.json HTTP ${res.status}`);
  }
  return res.json();
}

async function isStorybookUp(baseUrl) {
  try {
    await fetchIndex(baseUrl);
    return true;
  } catch {
    return false;
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: "inherit",
      shell: process.platform === "win32",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function buildStaticStorybook() {
  fs.rmSync(STATIC_DIR, { recursive: true, force: true });
  await run("npx", ["storybook", "build", "-o", STATIC_DIR]);
}

function startStaticServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["serve", STATIC_DIR, "-l", String(port), "--no-clipboard"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let resolved = false;
    const finish = (err) => {
      if (resolved) return;
      resolved = true;
      if (err) reject(err);
    };

    const onData = (chunk) => {
      const text = chunk.toString();
      if (/accepting connections|Local:/i.test(text)) {
        resolved = true;
        resolve(child);
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", finish);
    child.on("exit", (code) => finish(new Error(`serve exited ${code}`)));

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(child);
      }
    }, 5000);
  });
}

async function waitForServer(baseUrl, attempts = 60) {
  for (let i = 0; i < attempts; i += 1) {
    if (await isStorybookUp(baseUrl)) return;
    await sleep(500);
  }
  throw new Error(`Storybook did not become ready at ${baseUrl}`);
}

function uiStoryEntries(index) {
  const entries = index.entries ?? {};
  return Object.values(entries).filter(
    (entry) =>
      entry.type === "story" &&
      typeof entry.title === "string" &&
      entry.title.startsWith("UI/") &&
      typeof entry.id === "string",
  );
}

async function captureStories(baseUrl) {
  const index = await fetchIndex(baseUrl);
  const stories = uiStoryEntries(index);
  if (stories.length === 0) {
    throw new Error("No UI/* stories found in Storybook index.json");
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    colorScheme: "dark",
  });
  const page = await context.newPage();

  const written = [];
  for (const story of stories) {
    const url = `${baseUrl}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
    await page.evaluate((bg) => {
      document.documentElement.style.background = bg;
      document.body.style.background = bg;
    }, BG);
    await sleep(300);

    const outPath = path.join(OUT_DIR, `${story.id}.png`);
    await page.screenshot({ path: outPath, fullPage: true });
    written.push(outPath);
    console.log(`Wrote ${outPath}`);
    console.log(`Open: file://${outPath}`);
  }

  await browser.close();
  return written;
}

async function main() {
  const baseUrl = `http://127.0.0.1:${STORYBOOK_PORT}`;
  let serveChild = null;
  let startedServe = false;

  try {
    if (!(await isStorybookUp(baseUrl))) {
      console.log("Storybook not running — building static catalog…");
      await buildStaticStorybook();
      console.log(`Serving ${STATIC_DIR} on port ${STORYBOOK_PORT}…`);
      serveChild = await startStaticServer(STORYBOOK_PORT);
      startedServe = true;
      await waitForServer(baseUrl);
    } else {
      console.log(`Using Storybook at ${baseUrl}`);
    }

    const files = await captureStories(baseUrl);
    console.log(`Captured ${files.length} story screenshot(s) under ${OUT_DIR}`);
  } finally {
    if (startedServe && serveChild && !serveChild.killed) {
      serveChild.kill("SIGTERM");
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
