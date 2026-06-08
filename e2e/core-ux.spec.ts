import { expect, test } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { E2E_PERSIST_FLUSH_MS, launchHarness, setOpenToComposeOnLaunch } from "./helpers";

const HARNESS_E2E_REPLY = "Harness E2E assistant reply.";

test.describe.configure({ mode: "serial" });

let electronApp: ElectronApplication;

async function page(): Promise<Page> {
  return electronApp.firstWindow();
}

test.beforeAll(async () => {
  electronApp = await launchHarness();
});

test.afterAll(async () => {
  await electronApp.close();
});

test("chat persists across relaunch", async () => {
  let win = await page();
  await setOpenToComposeOnLaunch(win, false);
  await win.getByTestId("sidebar-new-chat").click();
  const input = win.getByTestId("chat-input");
  await input.fill("persist me");
  await win.getByTestId("chat-send").click();
  await expect(win.getByTestId("chat-messages")).toContainText(HARNESS_E2E_REPLY, { timeout: 25_000 });

  await win.waitForTimeout(E2E_PERSIST_FLUSH_MS);
  await electronApp.close();
  electronApp = await launchHarness();
  win = await page();
  await expect(win.getByTestId("chat-messages")).toContainText("persist me", { timeout: 25_000 });
  await expect(win.getByTestId("chat-messages")).toContainText(HARNESS_E2E_REPLY, { timeout: 25_000 });
});

test("delete conversation keeps other conversation", async () => {
  const win = await page();
  await win.getByTestId("sidebar-new-chat").click();
  await win.getByTestId("chat-input").fill("first thread");
  await win.getByTestId("chat-send").click();
  await expect(win.getByTestId("chat-messages")).toContainText(HARNESS_E2E_REPLY, { timeout: 25_000 });

  await win.getByTestId("sidebar-new-chat").click();
  await win.getByTestId("chat-input").fill("second thread");
  await win.getByTestId("chat-send").click();
  await expect(win.getByTestId("chat-messages")).toContainText("second thread");

  const rows = win.getByTestId("sidebar-conversation");
  const beforeCount = await rows.count();
  await rows.nth(0).hover();
  await rows.nth(0).getByLabel("Delete conversation").click();
  await expect(rows).toHaveCount(beforeCount - 1);

  await rows.nth(0).click();
  await expect(win.getByTestId("chat-messages")).toContainText("first thread");
});

test("settings weather zip and auto-send persist", async () => {
  const win = await page();
  await win.getByTestId("sidebar-settings").click();
  await win.getByRole("tab", { name: "Voice" }).click();
  const toggle = win.getByTestId("settings-auto-send");
  const before = await toggle.isChecked();
  await win.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="settings-auto-send"]');
    if (!el) throw new Error("settings-auto-send missing");
    el.click();
  });
  await expect(toggle).toBeChecked({ checked: !before });

  await win.getByRole("tab", { name: "Tools" }).click();
  const zip = win.getByTestId("settings-weather-zip");
  await zip.fill("10001");
  await win.waitForTimeout(700);
  await win.getByTestId("sidebar-new-chat").click();
  await win.getByTestId("sidebar-settings").click();
  await win.getByRole("tab", { name: "Voice" }).click();
  await expect(win.getByTestId("settings-auto-send")).toBeChecked({ checked: !before });
  await win.getByRole("tab", { name: "Tools" }).click();
  await expect(win.getByTestId("settings-weather-zip")).toHaveValue("10001");
});

test("tasks flow add and keep active after clear", async () => {
  const win = await page();
  await win.getByRole("button", { name: "Tasks" }).click();
  await expect(win.getByTestId("tasks-composer")).toBeVisible();
  const box = win.getByLabel("New task");
  await box.fill("e2e task keep");
  await win.getByRole("button", { name: "Add" }).click();
  await expect(win.getByText("e2e task keep")).toBeVisible();
});
