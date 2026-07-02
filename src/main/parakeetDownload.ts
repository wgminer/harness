import { createHash, type Hash } from "crypto";
import { createWriteStream, existsSync, mkdirSync, rmSync, statfsSync, statSync } from "fs";
import { open, readFile, rename, unlink, writeFile } from "fs/promises";
import { get as httpGet } from "http";
import { get as httpsGet } from "https";
import { join } from "path";
import { URL } from "url";
import { BrowserWindow, ipcMain } from "electron";
import {
  getParakeetManifestUrl,
  parseParakeetManifest,
  type ParakeetInstalledMarker,
  type ParakeetModelManifest,
} from "../shared/parakeetModel";
import { IDLE_PARAKEET_STATUS, type ParakeetStatus } from "../shared/parakeetStatus";
import {
  getInstalledMarkerPath,
  getParakeetModelDir,
  getParakeetModelVocabPath,
  getParakeetModelWeightsPath,
  isParakeetModelInstalled,
} from "./parakeetModelInstall";
import { WEIGHTS_PART, WEIGHTS_PART_META } from "./parakeetPaths";

const MIN_FREE_BYTES = 2_500_000_000;
const PROGRESS_THROTTLE_MS = 500;
const HASH_CHUNK = 1024 * 1024;

let currentStatus: ParakeetStatus = IDLE_PARAKEET_STATUS;
let inFlight: Promise<void> | null = null;
let cancelRequested = false;
let lastProgressBroadcast = 0;
let lastProgressPercent = -1;

function isDarwin(): boolean {
  return process.platform === "darwin";
}

function broadcastStatus(status: ParakeetStatus): void {
  currentStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("parakeet:status", status);
    }
  }
}

function maybeBroadcastProgress(percent: number): void {
  const now = Date.now();
  const rounded = Math.min(100, Math.max(0, Math.round(percent)));
  if (
    rounded !== lastProgressPercent &&
    (now - lastProgressBroadcast >= PROGRESS_THROTTLE_MS ||
      rounded === 100 ||
      Math.abs(rounded - lastProgressPercent) >= 1)
  ) {
    lastProgressBroadcast = now;
    lastProgressPercent = rounded;
    broadcastStatus({ status: "downloading", percent: rounded });
  }
}

function assertDiskSpace(dir: string, neededBytes: number): void {
  try {
    const st = statfsSync(dir);
    const free = Number(st.bavail) * Number(st.bsize);
    if (free < neededBytes) {
      throw new Error(
        `Not enough disk space for the Parakeet model (need ~${Math.ceil(neededBytes / 1e9)} GB free).`
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes("Not enough disk space")) throw err;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch manifest (${res.status}): ${url}`);
  }
  return res.json();
}

interface PartMeta {
  version: string;
  weightsSha256: string;
  bytesReceived: number;
}

async function readPartMeta(partMetaPath: string): Promise<PartMeta | null> {
  if (!existsSync(partMetaPath)) return null;
  try {
    const raw = JSON.parse(await readFile(partMetaPath, "utf8")) as Partial<PartMeta>;
    if (
      typeof raw.version === "string" &&
      typeof raw.weightsSha256 === "string" &&
      typeof raw.bytesReceived === "number"
    ) {
      return raw as PartMeta;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function writePartMeta(partMetaPath: string, meta: PartMeta): Promise<void> {
  await writeFile(partMetaPath, `${JSON.stringify(meta)}\n`, "utf8");
}

async function hashFileBytes(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(HASH_CHUNK);
    let pos = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (bytesRead <= 0) break;
      hash.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
    }
  } finally {
    await fh.close();
  }
  return hash.digest("hex");
}

function requestWithRange(
  url: string,
  startByte: number
): Promise<{ statusCode: number; body: NodeJS.ReadableStream }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const getter = parsed.protocol === "https:" ? httpsGet : httpGet;
    const req = getter(
      url,
      { headers: startByte > 0 ? { Range: `bytes=${startByte}-` } : {} },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          void requestWithRange(next, startByte).then(resolve, reject);
          return;
        }
        resolve({ statusCode: res.statusCode ?? 0, body: res });
      }
    );
    req.on("error", reject);
  });
}

async function streamToHash(filePath: string, hash: Hash): Promise<void> {
  const fh = await open(filePath, "r");
  try {
    const buf = Buffer.alloc(HASH_CHUNK);
    let pos = 0;
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
      if (bytesRead <= 0) break;
      hash.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
    }
  } finally {
    await fh.close();
  }
}

async function downloadWeightsFile(
  url: string,
  partPath: string,
  partMetaPath: string,
  manifest: ParakeetModelManifest,
  onProgress: (received: number, total: number) => void
): Promise<void> {
  const expectedBytes = manifest.files.weights.bytes;
  const expectedSha256 = manifest.files.weights.sha256;

  let partMeta = await readPartMeta(partMetaPath);
  if (
    partMeta &&
    (partMeta.version !== manifest.version || partMeta.weightsSha256 !== expectedSha256)
  ) {
    await unlink(partPath).catch(() => {});
    await unlink(partMetaPath).catch(() => {});
    partMeta = null;
  }

  let startByte = 0;
  if (partMeta && existsSync(partPath)) {
    const size = statSync(partPath).size;
    if (size === partMeta.bytesReceived && size > 0 && size < expectedBytes) {
      startByte = size;
    } else if (size >= expectedBytes) {
      await unlink(partPath).catch(() => {});
      await unlink(partMetaPath).catch(() => {});
      partMeta = null;
    } else {
      await unlink(partPath).catch(() => {});
      await unlink(partMetaPath).catch(() => {});
      partMeta = null;
    }
  }

  if (!partMeta) {
    partMeta = { version: manifest.version, weightsSha256: expectedSha256, bytesReceived: 0 };
  }

  const attempt = async (from: number): Promise<void> => {
    const { statusCode, body } = await requestWithRange(url, from);
    if (from > 0 && statusCode !== 206) {
      await unlink(partPath).catch(() => {});
      await unlink(partMetaPath).catch(() => {});
      return attempt(0);
    }
    if (from === 0 && statusCode !== 200 && statusCode !== 206) {
      throw new Error(`Download failed (${statusCode}): ${url}`);
    }

    const out = createWriteStream(partPath, { flags: from > 0 ? "a" : "w" });
    const runningHash = createHash("sha256");
    if (from > 0 && existsSync(partPath)) {
      await streamToHash(partPath, runningHash);
    }

    let received = from;
    for await (const chunk of body as AsyncIterable<Buffer>) {
      if (cancelRequested) throw new Error("Download cancelled.");
      out.write(chunk);
      runningHash.update(chunk);
      received += chunk.length;
      onProgress(received, expectedBytes);
      await writePartMeta(partMetaPath, { ...partMeta!, bytesReceived: received });
    }

    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve());
      out.on("error", reject);
    });

    if (received !== expectedBytes) {
      throw new Error(`Downloaded file size mismatch (expected ${expectedBytes}, got ${received}).`);
    }
    const digest = runningHash.digest("hex");
    if (digest !== expectedSha256) {
      throw new Error("Downloaded file failed checksum verification.");
    }
  };

  await attempt(startByte);
}

async function downloadSmallFile(
  url: string,
  destPath: string,
  expectedSha256: string,
  expectedBytes: number
): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== expectedBytes) {
    throw new Error(`Downloaded file size mismatch for ${destPath}`);
  }
  const digest = createHash("sha256").update(buf).digest("hex");
  if (digest !== expectedSha256) {
    throw new Error("Downloaded file failed checksum verification.");
  }
  await writeFile(destPath, buf);
}

async function runDownload(manifest: ParakeetModelManifest): Promise<void> {
  const modelDir = getParakeetModelDir();
  mkdirSync(modelDir, { recursive: true });

  const needed = manifest.files.weights.bytes + manifest.files.vocab.bytes + 50_000_000;
  assertDiskSpace(modelDir, Math.max(MIN_FREE_BYTES, needed));

  const weightsPath = getParakeetModelWeightsPath();
  const vocabPath = getParakeetModelVocabPath();
  const partPath = join(modelDir, WEIGHTS_PART);
  const partMetaPath = join(modelDir, WEIGHTS_PART_META);

  broadcastStatus({ status: "checking" });
  lastProgressPercent = -1;

  await downloadSmallFile(
    manifest.files.vocab.url,
    vocabPath,
    manifest.files.vocab.sha256,
    manifest.files.vocab.bytes
  );

  broadcastStatus({ status: "downloading", percent: 0 });

  await downloadWeightsFile(
    manifest.files.weights.url,
    partPath,
    partMetaPath,
    manifest,
    (received, total) => {
      const vocabShare = 0.02;
      const weightShare = 1 - vocabShare;
      const p = vocabShare * 100 + weightShare * (total > 0 ? (received / total) * 100 : 0);
      maybeBroadcastProgress(p);
    }
  );

  await rename(partPath, weightsPath);
  await unlink(partMetaPath).catch(() => {});

  const marker: ParakeetInstalledMarker = {
    version: manifest.version,
    weightsSha256: manifest.files.weights.sha256,
    vocabSha256: manifest.files.vocab.sha256,
    weightsBytes: manifest.files.weights.bytes,
    vocabBytes: manifest.files.vocab.bytes,
    installedAt: Date.now(),
  };
  await writeFile(getInstalledMarkerPath(), `${JSON.stringify(marker, null, 2)}\n`, "utf8");

  broadcastStatus({ status: "ready" });
}

export async function ensureParakeetModel(): Promise<void> {
  if (!isDarwin()) {
    throw new Error("Parakeet is only available on macOS.");
  }
  if (await isParakeetModelInstalled()) {
    broadcastStatus({ status: "ready" });
    return;
  }
  if (inFlight) {
    return inFlight;
  }

  cancelRequested = false;
  inFlight = (async () => {
    try {
      const manifestUrl = getParakeetManifestUrl();
      const raw = await fetchJson(manifestUrl);
      const manifest = parseParakeetManifest(raw);
      await runDownload(manifest);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== "Download cancelled.") {
        broadcastStatus({ status: "error", message });
      } else {
        broadcastStatus({ status: "idle" });
      }
      throw err;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function removeParakeetModel(): Promise<void> {
  if (inFlight) {
    cancelRequested = true;
    try {
      await inFlight;
    } catch {
      /* expected on cancel */
    }
  }
  const modelDir = getParakeetModelDir();
  if (existsSync(modelDir)) {
    rmSync(modelDir, { recursive: true, force: true });
  }
  broadcastStatus({ status: "idle" });
}

export function registerParakeetHandlers(): void {
  if (!isDarwin()) {
    ipcMain.handle("parakeet:getStatus", () => ({ status: "idle" }));
    ipcMain.handle("parakeet:isModelInstalled", () => false);
    ipcMain.handle("parakeet:ensureModel", async () => {
      throw new Error("Parakeet is only available on macOS.");
    });
    ipcMain.handle("parakeet:cancelDownload", async () => {});
    ipcMain.handle("parakeet:removeModel", async () => {});
    return;
  }

  ipcMain.handle("parakeet:getStatus", async () => {
    if (await isParakeetModelInstalled()) {
      return { status: "ready" } satisfies ParakeetStatus;
    }
    return currentStatus;
  });

  ipcMain.handle("parakeet:isModelInstalled", async () => isParakeetModelInstalled());

  ipcMain.handle("parakeet:ensureModel", async () => {
    await ensureParakeetModel();
  });

  ipcMain.handle("parakeet:cancelDownload", async () => {
    cancelRequested = true;
    broadcastStatus({ status: "idle" });
  });

  ipcMain.handle("parakeet:removeModel", async () => {
    await removeParakeetModel();
  });

  void isParakeetModelInstalled().then((installed) => {
    if (installed) broadcastStatus({ status: "ready" });
  });
}

export function __testOnly_resetParakeetDownloadState(): void {
  currentStatus = IDLE_PARAKEET_STATUS;
  inFlight = null;
  cancelRequested = false;
  lastProgressBroadcast = 0;
  lastProgressPercent = -1;
}

export async function __testOnly_runDownloadWithManifest(manifest: ParakeetModelManifest): Promise<void> {
  cancelRequested = false;
  await runDownload(manifest);
}

export { hashFileBytes };
