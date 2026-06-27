import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: {
    timeout: 25_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.015,
      animations: "disabled",
    },
  },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.cjs",
  use: {
    trace: "on-first-retry",
  },
});
