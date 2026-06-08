import path from "node:path";
import { _electron as electron } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";

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

/** Debounced settings + ui-session writes need time to flush before relaunch in e2e. */
export const E2E_PERSIST_FLUSH_MS = 800;

export async function setOpenToComposeOnLaunch(win: Page, enabled: boolean): Promise<void> {
  await win.getByTestId("sidebar-settings").click();
  const toggle = win.getByTestId("settings-open-to-compose-on-launch");
  const checked = await toggle.isChecked();
  if (checked !== enabled) {
    await win.evaluate(() => {
      document.querySelector<HTMLInputElement>('[data-testid="settings-open-to-compose-on-launch"]')?.click();
    });
    await win.waitForTimeout(E2E_PERSIST_FLUSH_MS);
  }
}
