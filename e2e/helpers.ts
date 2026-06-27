import path from "node:path";
import { _electron as electron, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import type { LayoutOptions } from "../shared/types";

// Electron npm package resolves to the OS binary path (not the `electron` API).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronBinary = require("electron") as string;

/** Fixed content size for visual regression (matches typical desktop capture). */
export const VISUAL_CAPTURE_SIZE = { width: 1280, height: 800 } as const;

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

/** Launch with the design grid overlay persisted in layout.json (see e2eBootstrap). */
export function launchHarnessWithGridOverlay(
  gridOverlay: Exclude<LayoutOptions["gridOverlay"], "off">,
): Promise<ElectronApplication> {
  return launchHarness({ HARNESS_E2E_GRID_OVERLAY: gridOverlay });
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

export async function setGridOverlay(
  win: Page,
  value: LayoutOptions["gridOverlay"],
): Promise<void> {
  await win.getByTestId("sidebar-settings").click();
  await win.getByTestId("settings-grid-overlay").selectOption(value);
  await win.waitForTimeout(E2E_PERSIST_FLUSH_MS);
}

export async function expectGridOverlay(
  win: Page,
  grid: LayoutOptions["gridOverlay"],
): Promise<void> {
  if (grid === "off") {
    await expect(win.getByTestId("app-grid-overlay")).toHaveCount(0);
    return;
  }
  await expect(win.getByTestId("app-grid-overlay")).toHaveAttribute("data-grid-overlay", grid);
}

/** Resize window and freeze motion so screenshots are stable across runs. */
export async function prepareVisualCapture(
  electronApp: ElectronApplication,
  win: Page,
): Promise<void> {
  await electronApp.evaluate(({ BrowserWindow }, size) => {
    const browserWin = BrowserWindow.getAllWindows()[0];
    browserWin.setContentSize(size.width, size.height);
  }, VISUAL_CAPTURE_SIZE);

  await win.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });

  await win.waitForTimeout(350);
}

export async function captureAppScreenshot(win: Page, name: string): Promise<void> {
  await expect(win).toHaveScreenshot(`${name}.png`, {
    fullPage: false,
    animations: "disabled",
  });
}
