import { expect, test } from "@playwright/test";
import path from "node:path";
import type { ElectronApplication, Page } from "@playwright/test";
import { E2E_PERSIST_FLUSH_MS, launchHarness, setOpenToComposeOnLaunch } from "./helpers";

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

test("notes persist across relaunch", async () => {
  let win = await page();
  await setOpenToComposeOnLaunch(win, false);
  await win.getByTestId("sidebar-notes").click();
  await win.getByRole("button", { name: /Blank/ }).click();
  const editor = win.getByTestId("notes-editor");
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.fill("# Notes\n\nkeep this text");
  await win.waitForTimeout(E2E_PERSIST_FLUSH_MS);

  await electronApp.close();
  electronApp = await launchHarness({
    HARNESS_E2E_STREAM_MS: "120",
    HARNESS_E2E_IMPORT_DIR: path.join(process.cwd(), "e2e/fixtures/chatgpt-sample"),
  });
  win = await page();
  await win.getByRole("button", { name: /^Notes/ }).click();
  await expect(win.getByTestId("notes-editor")).toHaveValue("# Notes\n\nkeep this text", {
    timeout: 15_000,
  });
});

test("chatgpt import is deduped on rerun", async () => {
  const win = await page();
  const first = await win.evaluate(async () => window.electron.memory.importFromChatGPTFolder());
  expect(first.imported).toBeGreaterThanOrEqual(1);

  const second = await win.evaluate(async () => window.electron.memory.importFromChatGPTFolder());
  expect(second.imported).toBe(0);
});

test("chat turn flow keeps focus and follows live edge", async () => {
  const win = await page();
  await win.getByTestId("sidebar-new-chat").click();

  const input = win.getByTestId("chat-input");
  await input.fill("first turn");
  await input.press("Enter");
  await expect(win.getByRole("button", { name: "Stop" })).toBeVisible({ timeout: 5_000 });
  await expect(win.getByRole("button", { name: "Stop" })).toBeHidden({ timeout: 10_000 });

  await input.fill("second turn");
  await input.press("Enter");
  await expect(win.getByRole("button", { name: "Stop" })).toBeVisible({ timeout: 5_000 });

  const isNearBottom = await win.evaluate(() => {
    const scroll = document.querySelector(".chat-scroll") as HTMLDivElement | null;
    if (!scroll) return false;
    const distance = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    return distance <= 48;
  });
  expect(isNearBottom).toBe(true);

  await expect(win.getByRole("button", { name: "Stop" })).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => win.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe("chat-input");

  await input.fill("dedupe send");
  await Promise.all([input.press("Enter"), input.press("Enter")]);
  await expect(win.getByRole("button", { name: "Stop" })).toBeHidden({ timeout: 10_000 });
  await expect(win.locator(".message-block.user", { hasText: "dedupe send" })).toHaveCount(1);
});

test("chat scroll clearance tracks composer height", async () => {
  const win = await page();
  await win.getByTestId("sidebar-new-chat").click();

  const input = win.getByTestId("chat-input");
  for (let i = 0; i < 8; i += 1) {
    await input.fill(`message ${i} ` + "x ".repeat(50));
    await input.press("Enter");
    await expect(win.getByRole("button", { name: "Stop" })).toBeVisible({ timeout: 5_000 });
    await expect(win.getByRole("button", { name: "Stop" })).toBeHidden({ timeout: 10_000 });
  }

  const layoutOk = await win.evaluate(() => {
    const scroll = document.querySelector(".chat-scroll") as HTMLDivElement | null;
    const composer = document.querySelector('[data-testid="chat-composer"]');
    if (!scroll || !composer) return false;
    const paddingBottom = Number.parseFloat(window.getComputedStyle(scroll).paddingBottom || "0");
    const composerHeight = composer.getBoundingClientRect().height;
    const liveEdgeDistance = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight;
    return paddingBottom >= composerHeight && liveEdgeDistance <= 64;
  });
  expect(layoutOk).toBe(true);
  await expect(win.getByText("Harness E2E assistant reply.").last()).toBeVisible();
});
