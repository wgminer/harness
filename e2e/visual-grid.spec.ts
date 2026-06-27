import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import {
  captureAppScreenshot,
  expectGridOverlay,
  launchHarnessWithGridOverlay,
  prepareVisualCapture,
  setOpenToComposeOnLaunch,
} from "./helpers";

/**
 * Visual regression with the 8px design grid overlay enabled.
 *
 * Baselines live in `e2e/visual-grid.spec.ts-snapshots/` and are platform-specific
 * (font rendering differs by OS). Run locally on macOS when updating snapshots:
 *
 *   npm run test:e2e:visual:update
 *
 * Review diffs in the Playwright HTML report:
 *
 *   npx playwright show-report
 */
test.describe.configure({ mode: "serial" });

let electronApp: ElectronApplication;

async function page(): Promise<Page> {
  return electronApp.firstWindow();
}

test.beforeAll(async () => {
  electronApp = await launchHarnessWithGridOverlay("8");
});

test.afterAll(async () => {
  await electronApp.close();
});

test("8px grid overlay is active", async () => {
  const win = await page();
  await expect(win.getByTestId("sidebar-new-chat")).toBeVisible({ timeout: 30_000 });
  await expectGridOverlay(win, "8");
});

test("new chat compose — grid snapshot", async () => {
  const win = await page();
  await setOpenToComposeOnLaunch(win, true);
  await win.getByTestId("sidebar-new-chat").click();
  await expect(win.getByTestId("chat-composer")).toBeVisible();
  await expectGridOverlay(win, "8");
  await prepareVisualCapture(electronApp, win);
  await captureAppScreenshot(win, "new-chat-compose-8px-grid");
});

test("chat thread — grid snapshot", async () => {
  const win = await page();
  await setOpenToComposeOnLaunch(win, false);
  await win.getByTestId("sidebar-new-chat").click();
  await win.getByTestId("chat-input").fill("visual grid check");
  await win.getByTestId("chat-send").click();
  await expect(win.getByTestId("chat-messages")).toContainText("Harness E2E assistant reply.", {
    timeout: 25_000,
  });
  await expectGridOverlay(win, "8");
  await prepareVisualCapture(electronApp, win);
  await captureAppScreenshot(win, "chat-thread-8px-grid");
});

test("tasks — grid snapshot", async () => {
  const win = await page();
  await win.getByRole("button", { name: "Tasks" }).click();
  await expect(win.getByTestId("tasks-composer")).toBeVisible();
  await expectGridOverlay(win, "8");
  await prepareVisualCapture(electronApp, win);
  await captureAppScreenshot(win, "tasks-8px-grid");
});

test("settings appearance — grid snapshot", async () => {
  const win = await page();
  await win.getByTestId("sidebar-settings").click();
  await expect(win.getByTestId("settings-grid-overlay")).toHaveValue("8");
  await expectGridOverlay(win, "8");
  await prepareVisualCapture(electronApp, win);
  await captureAppScreenshot(win, "settings-appearance-8px-grid");
});
