import { expect, test } from "@playwright/test";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { launchHarness } from "./helpers";

test.describe.configure({ mode: "serial" });

let electronApp: ElectronApplication;

async function page(): Promise<Page> {
  return electronApp.firstWindow();
}

test.beforeAll(async () => {
  electronApp = await launchHarness({
    HARNESS_E2E_STREAM_MS: "120",
    HARNESS_E2E_IMPORT_DIR: path.join(process.cwd(), "e2e/fixtures/chatgpt-sample"),
  });
});

test.afterAll(async () => {
  await electronApp.close();
});

test("stop mid-stream preserves partial assistant output", async () => {
  const win = await page();
  await win.getByTestId("sidebar-new-chat").click();
  await win.getByTestId("chat-input").fill("abort me");
  await win.getByTestId("chat-send").click();

  const stop = win.getByRole("button", { name: "Stop" });
  await expect(stop).toBeVisible({ timeout: 5_000 });
  await stop.click();
  await expect(stop).toBeHidden({ timeout: 10_000 });

  const messages = win.getByTestId("chat-messages");
  const text = await messages.innerText();
  expect(text).toContain("Harness");
  expect(text).not.toContain("[Error]");
});

test("writing surface survives relaunch with save history", async () => {
  let win = await page();
  await win.getByTestId("sidebar-writing").click();
  const editor = win.getByTestId("writing-editor");
  await editor.fill("# Desk\n\nkeep this text");
  await win.getByRole("button", { name: "Save", exact: true }).click();
  await win.waitForTimeout(600);

  await win.getByRole("button", { name: "Open save history panel" }).click();
  await expect(win.getByText("Save History")).toBeVisible();
  await expect(win.getByText(/1\/\d+/)).toBeVisible();

  await electronApp.close();
  electronApp = await launchHarness({
    HARNESS_E2E_STREAM_MS: "120",
    HARNESS_E2E_IMPORT_DIR: path.join(process.cwd(), "e2e/fixtures/chatgpt-sample"),
  });
  win = await page();
  await win.getByTestId("sidebar-writing").click();
  await expect(win.getByTestId("writing-editor")).toHaveValue("# Desk\n\nkeep this text");
});

test("chatgpt import is deduped on rerun", async () => {
  const win = await page();
  const first = await win.evaluate(async () => window.electron.memory.importFromChatGPTFolder());
  expect(first.imported).toBeGreaterThanOrEqual(1);

  const second = await win.evaluate(async () => window.electron.memory.importFromChatGPTFolder());
  expect(second.imported).toBe(0);
});
