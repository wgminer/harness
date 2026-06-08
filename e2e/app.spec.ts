import { test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "@playwright/test";
import { E2E_PERSIST_FLUSH_MS, launchHarness, setOpenToComposeOnLaunch } from "./helpers";

const HARNESS_E2E_REPLY = "Harness E2E assistant reply.";
const HARNESS_E2E_TRANSCRIBE = "Harness E2E transcribed text.";

test.describe.configure({ mode: "serial" });

let electronApp: ElectronApplication;

test.beforeAll(async () => {
  electronApp = await launchHarness();
});

test.afterAll(async () => {
  await electronApp.close();
});

function page(): Promise<Page> {
  return electronApp.firstWindow();
}

test("sidebar and new chat are visible", async () => {
  const win = await page();
  await expect(win.getByTestId("sidebar-new-chat")).toBeVisible({ timeout: 30_000 });
  await win.getByTestId("sidebar-new-chat").click();
  await expect(win.getByTestId("chat-composer")).toBeVisible();
  await expect(win.getByTestId("chat-input")).toBeVisible();
});

test("send shows deterministic assistant reply and clears composer", async () => {
  const win = await page();
  await win.getByTestId("sidebar-new-chat").click();
  const input = win.getByTestId("chat-input");
  const send = win.getByTestId("chat-send");
  await input.fill("hello from e2e");
  await send.click();
  await expect(send).toBeDisabled({ timeout: 5_000 });
  await expect(win.getByTestId("chat-messages")).toContainText(HARNESS_E2E_REPLY, { timeout: 25_000 });
  await expect(input).toHaveValue("");
  // Send stays disabled when the composer is empty (no draft text).
  await expect(send).toBeDisabled();
});

test("e2e inject Fn tap-toggle delivers transcribed text to chat", async () => {
  const win = await page();
  await win.bringToFront();
  await win.getByTestId("sidebar-new-chat").click();
  await expect(win.getByTestId("chat-input")).toBeVisible();
  await win.getByTestId("chat-input").click();
  const base = 12_000_000;
  await win.evaluate(
    async (ms) => {
      const e = window.electron.e2e;
      if (!e) throw new Error("e2e bridge missing (HARNESS_E2E)");
      await e.injectFnEvent("down", ms);
      await e.injectFnEvent("up", ms + 50);
      await e.injectFnEvent("down", ms + 200);
      await e.injectFnEvent("up", ms + 250);
    },
    base
  );
  await expect(win.getByTestId("chat-messages")).toContainText(HARNESS_E2E_TRANSCRIBE, { timeout: 25_000 });
});

test("open to compose on launch shows splash instead of last thread", async () => {
  const win = await page();
  await win.getByTestId("sidebar-new-chat").click();
  await win.getByTestId("chat-input").fill("launch splash marker");
  await win.getByTestId("chat-send").click();
  await expect(win.getByTestId("chat-messages")).toContainText(HARNESS_E2E_REPLY, { timeout: 25_000 });

  await electronApp.close();
  electronApp = await launchHarness();
  const relaunched = await page();
  await expect(relaunched.getByTestId("chat-composer")).toBeVisible({ timeout: 30_000 });
  await expect(relaunched.locator('[data-testid="chat-messages"]')).toHaveCount(0);
});

test("restore session on launch reopens last conversation", async () => {
  const win = await page();
  await setOpenToComposeOnLaunch(win, false);

  await win.getByTestId("sidebar-new-chat").click();
  await win.getByTestId("chat-input").fill("restore session marker");
  await win.getByTestId("chat-send").click();
  await expect(win.getByTestId("chat-messages")).toContainText("restore session marker", {
    timeout: 25_000,
  });

  await win.waitForTimeout(E2E_PERSIST_FLUSH_MS);
  await electronApp.close();
  electronApp = await launchHarness();
  const relaunched = await page();
  await expect(relaunched.getByTestId("chat-messages")).toContainText("restore session marker", {
    timeout: 30_000,
  });
});

test("settings auto-send toggle persists", async () => {
  const win = await page();
  await win.getByTestId("sidebar-settings").click();
  await win.getByRole("tab", { name: "Voice" }).click();
  const toggle = win.getByTestId("settings-auto-send");
  await expect(toggle).toBeVisible();
  const before = await toggle.isChecked();
  await win.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="settings-auto-send"]');
    if (!el) throw new Error("settings-auto-send missing");
    el.click();
  });
  await expect(toggle).toBeChecked({ checked: !before });
  // Debounced save in SettingsView (500ms)
  await win.waitForTimeout(700);
  await win.getByTestId("sidebar-new-chat").click();
  await expect(win.getByTestId("chat-composer")).toBeVisible();
  await win.getByTestId("sidebar-settings").click();
  await win.getByRole("tab", { name: "Voice" }).click();
  await expect(win.getByTestId("settings-auto-send")).toBeChecked({ checked: !before });
});
