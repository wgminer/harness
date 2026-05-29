import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "path";
import { mkdir, writeFile } from "fs/promises";
import { createTempDir } from "./__tests__/tempDir";
import {
  buildDefaultViewSpec,
  validateConfigViewSpec,
  type ConfigViewSpec,
} from "../shared/configRegistry";
import { DEFAULT_SETTINGS } from "../shared/types";

let currentUserDataDir = "/tmp";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => currentUserDataDir),
  },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock("openai", () => ({
  default: vi.fn(),
}));

import {
  getConfigValues,
  setConfigValue,
  getConfigView,
} from "./configCanvas";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function seedUserData(): Promise<string> {
  const temp = await createTempDir("config-canvas-test-");
  cleanups.push(temp.cleanup);
  currentUserDataDir = temp.path;

  const settingsDir = join(temp.path, "local-data", "settings");
  await mkdir(settingsDir, { recursive: true });
  await writeFile(join(settingsDir, "settings.json"), JSON.stringify(DEFAULT_SETTINGS, null, 2));

  const appStateDir = join(temp.path, "local-data", "app-state");
  await mkdir(appStateDir, { recursive: true });

  return temp.path;
}

describe("configCanvas value routing", () => {
  it("reads settings values from settings.json", async () => {
    await seedUserData();
    const values = await getConfigValues();
    expect(values["weather.defaultZip"]).toBe(DEFAULT_SETTINGS.weather!.defaultZip);
    expect(values["recording.autoSend"]).toBe(DEFAULT_SETTINGS.recording!.autoSend);
  });

  it("writes settings values back to settings.json", async () => {
    await seedUserData();
    await setConfigValue("weather.defaultZip", "90210");
    const values = await getConfigValues();
    expect(values["weather.defaultZip"]).toBe("90210");
  });

  it("writes layout values to layout.json", async () => {
    await seedUserData();
    await setConfigValue("layout.sidebar", "right");
    const values = await getConfigValues();
    expect(values["layout.sidebar"]).toBe("right");
  });

  it("returns default view spec when none persisted", async () => {
    await seedUserData();
    const view = await getConfigView();
    expect(validateConfigViewSpec(view)).toBeNull();
    expect(view.sections.length).toBeGreaterThan(0);
    const defaultSpec = buildDefaultViewSpec();
    expect(view.sections.map((s) => s.title).sort()).toEqual(defaultSpec.sections.map((s) => s.title).sort());
  });
});

describe("configCanvas spec validation", () => {
  it("accepts a valid partial spec", () => {
    const spec: ConfigViewSpec = {
      title: "Voice",
      sections: [{ title: "Voice", entryIds: ["recording.autoSend"] }],
    };
    expect(validateConfigViewSpec(spec)).toBeNull();
  });
});
