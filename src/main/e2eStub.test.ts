import { afterEach, describe, expect, it } from "vitest";
import { isGlobalHotkeyDisabled, isHarnessE2E } from "../main/e2eStub";

describe("isGlobalHotkeyDisabled", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it("is disabled when HARNESS_DISABLE_GLOBAL_HOTKEY=1", () => {
    process.env.HARNESS_DISABLE_GLOBAL_HOTKEY = "1";
    expect(isGlobalHotkeyDisabled()).toBe(true);
  });

  it("is enabled without the env override", () => {
    delete process.env.HARNESS_DISABLE_GLOBAL_HOTKEY;
    process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:5173";
    expect(isGlobalHotkeyDisabled()).toBe(false);
  });
});

describe("isHarnessE2E", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it("is true only when HARNESS_E2E=1", () => {
    process.env.HARNESS_E2E = "1";
    expect(isHarnessE2E()).toBe(true);
    delete process.env.HARNESS_E2E;
    expect(isHarnessE2E()).toBe(false);
  });
});
