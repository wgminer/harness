import { createServer, type Server } from "http";
import { readFile } from "fs/promises";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "./__tests__/tempDir";
import { parseParakeetManifest } from "../shared/parakeetModel";

let userDataDir = "/tmp/harness-parakeet-dl";
let packaged = true;

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
  app: {
    get isPackaged() {
      return packaged;
    },
    getAppPath: () => join(userDataDir, "app"),
    getPath: (name: string) => {
      if (name === "userData") return userDataDir;
      return `/tmp/${name}`;
    },
  },
}));

import {
  __testOnly_resetParakeetDownloadState,
  __testOnly_runDownloadWithManifest,
} from "./parakeetDownload";
import { getParakeetModelWeightsPath, isParakeetModelInstalled } from "./parakeetModelInstall";

const fixtureRoot = join(process.cwd(), "e2e/fixtures/parakeet");
const cleanups: Array<() => Promise<void>> = [];
let server: Server | null = null;

async function startFixtureServer(): Promise<{
  manifestUrl: string;
  manifest: ReturnType<typeof parseParakeetManifest>;
}> {
  const [vocab, weights, manifestTemplate] = await Promise.all([
    readFile(join(fixtureRoot, "vocab.txt")),
    readFile(join(fixtureRoot, "model.safetensors")),
    readFile(join(fixtureRoot, "manifest.json"), "utf8"),
  ]);

  return new Promise((resolve, reject) => {
    const s = createServer((req, res) => {
      const addr = s.address();
      const port = addr && typeof addr !== "string" ? addr.port : 0;
      const base = `http://127.0.0.1:${port}`;
      const url = req.url ?? "/";
      if (url === "/manifest.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(manifestTemplate.replaceAll("PORT", String(port)));
        return;
      }
      if (url === "/vocab.txt") {
        res.writeHead(200);
        res.end(vocab);
        return;
      }
      if (url === "/model.safetensors") {
        const range = req.headers.range;
        if (range) {
          const m = /^bytes=(\d+)-/.exec(range);
          const start = m ? Number(m[1]) : 0;
          const chunk = weights.subarray(start);
          res.writeHead(206, {
            "Content-Range": `bytes ${start}-${weights.length - 1}/${weights.length}`,
            "Content-Length": String(chunk.length),
          });
          res.end(chunk);
          return;
        }
        res.writeHead(200, { "Content-Length": String(weights.length) });
        res.end(weights);
        return;
      }
      res.writeHead(404);
      res.end();
    });
    s.listen(0, "127.0.0.1", async () => {
      const addr = s.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("no port"));
        return;
      }
      server = s;
      const manifestUrl = `http://127.0.0.1:${addr.port}/manifest.json`;
      const manifestRes = await fetch(manifestUrl);
      const manifest = parseParakeetManifest(await manifestRes.json());
      manifest.files.vocab.url = `${baseFromPort(addr.port)}/vocab.txt`;
      manifest.files.weights.url = `${baseFromPort(addr.port)}/model.safetensors`;
      resolve({ manifestUrl, manifest });
    });
    s.on("error", reject);
  });
}

function baseFromPort(port: number): string {
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  __testOnly_resetParakeetDownloadState();
  delete process.env.PARAKEET_MANIFEST_URL;
  while (cleanups.length > 0) {
    const c = cleanups.pop();
    if (c) await c();
  }
});

beforeEach(async () => {
  const temp = await createTempDir("parakeet-dl-");
  userDataDir = temp.path;
  packaged = true;
  cleanups.push(temp.cleanup);
});

describe("parakeetDownload", () => {
  it("downloads fixture model into userData", async () => {
    const { manifestUrl, manifest } = await startFixtureServer();
    process.env.PARAKEET_MANIFEST_URL = manifestUrl;

    await __testOnly_runDownloadWithManifest(manifest);

    expect(await isParakeetModelInstalled()).toBe(true);
    expect(getParakeetModelWeightsPath()).toBeTruthy();
  }, 30_000);
});
