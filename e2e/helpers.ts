import path from "node:path";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";

// Electron npm package resolves to the OS binary path (not the `electron` API).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBinary = require("electron") as string;

export async function launchHarness(extraEnv?: Record<string, string>): Promise<ElectronApplication> {
  const mainJs = path.join(process.cwd(), "out/main/index.js");
  return electron.launch({
    executablePath: electronBinary,
    args: [mainJs],
    env: {
      ...process.env,
      HARNESS_E2E: "1",
      ...(extraEnv ?? {}),
    },
    cwd: process.cwd(),
  });
}
