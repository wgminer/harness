import { createServer, type Server } from "http";
import { readFile } from "fs/promises";
import { existsSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { test, expect } from "@playwright/test";
import { _electron as electron } from "@playwright/test";

const fixtureRoot = join(process.cwd(), "e2e/fixtures/parakeet");
const packagedApp = join(
  process.cwd(),
  "dist/mac-arm64/Harness.app/Contents/MacOS/Harness"
);

test.describe("parakeet model download", () => {
  test.skip(process.platform !== "darwin", "macOS only");
  test.skip(!existsSync(packagedApp), "requires slim dist build (npm run test:e2e:parakeet)");

  let server: Server;
  let manifestUrl: string;
  let userDataDir: string;

  test.beforeAll(async () => {
    const [vocab, weights, manifestTemplate] = await Promise.all([
      readFile(join(fixtureRoot, "vocab.txt")),
      readFile(join(fixtureRoot, "model.safetensors")),
      readFile(join(fixtureRoot, "manifest.json"), "utf8"),
    ]);

    await new Promise<void>((resolve, reject) => {
      server = createServer((req, res) => {
        const addr = server.address();
        const port = addr && typeof addr !== "string" ? addr.port : 0;
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
          res.writeHead(200, { "Content-Length": String(weights.length) });
          res.end(weights);
          return;
        }
        res.writeHead(404);
        res.end();
      });
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const addr = server.address();
    const port = addr && typeof addr !== "string" ? addr.port : 0;
    manifestUrl = `http://127.0.0.1:${port}/manifest.json`;
    userDataDir = mkdtempSync(join(tmpdir(), "harness-parakeet-e2e-"));
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  test("downloads model from Settings on first launch", async () => {
    const app = await electron.launch({
      executablePath: packagedApp,
      env: {
        ...process.env,
        PARAKEET_MANIFEST_URL: manifestUrl,
        HARNESS_USER_DATA_DIR: userDataDir,
      },
    });

    const win = await app.firstWindow();
    await win.getByTestId("sidebar-settings").click();
    await win.getByRole("tab", { name: "Voice" }).click();
    await expect(win.getByTestId("parakeet-model-status")).toContainText("Not installed");
    await win.getByTestId("parakeet-download-button").click();
    await expect(win.getByTestId("parakeet-model-status")).toContainText("Ready", {
      timeout: 60_000,
    });
    expect(existsSync(join(userDataDir, "parakeet-model/model.safetensors"))).toBe(true);
    await app.close();
  });
});
