import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "./__tests__/tempDir";
import { DEFAULT_THEME_SETTINGS } from "../shared/theme";

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

import { executeCustomizationTool } from "./customization";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    if (cleanup) await cleanup();
  }
});

async function makeUserDataDir(): Promise<string> {
  const temp = await createTempDir("customization-test-");
  cleanups.push(temp.cleanup);
  currentUserDataDir = temp.path;
  return temp.path;
}

describe("executeCustomizationTool", () => {
  it("get_theme returns settings and presets", async () => {
    await makeUserDataDir();
    const raw = executeCustomizationTool("get_theme", {});
    const payload = JSON.parse(raw) as {
      ok: boolean;
      settings: typeof DEFAULT_THEME_SETTINGS;
      presets: Array<{ id: string; label: string }>;
    };
    expect(payload.ok).toBe(true);
    expect(payload.settings.fontSize).toBe(DEFAULT_THEME_SETTINGS.fontSize);
    expect(payload.presets.map((p) => p.id)).toEqual(["dark", "light"]);
  });

  it("update_theme patches colors and returns applied settings", async () => {
    await makeUserDataDir();
    const raw = executeCustomizationTool("update_theme", { accent: "#ff00ff", fg: "#eeeeee", bg: "#111111" });
    const payload = JSON.parse(raw) as { ok: boolean; settings: { accent: string; fg: string; bg: string } };
    expect(payload.ok).toBe(true);
    expect(payload.settings.accent).toBe("#ff00ff");
    expect(payload.settings.fg).toBe("#eeeeee");
    expect(payload.settings.bg).toBe("#111111");
  });

  it("apply_theme_preset applies palette colors", async () => {
    await makeUserDataDir();
    executeCustomizationTool("update_theme", { accent: "#ff00ff" });
    const raw = executeCustomizationTool("apply_theme_preset", { preset: "light" });
    const payload = JSON.parse(raw) as {
      ok: boolean;
      preset: string;
      settings: { accent: string; fg: string; bg: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.preset).toBe("light");
    expect(payload.settings.bg).toBe("#ffffff");
    expect(payload.settings.accent).toBe("#3b6fd9");
  });

  it("accepts legacy preset aliases", async () => {
    await makeUserDataDir();
    const raw = executeCustomizationTool("apply_theme_preset", { preset: "paper" });
    const payload = JSON.parse(raw) as { ok: boolean; preset: string; settings: { bg: string } };
    expect(payload.ok).toBe(true);
    expect(payload.preset).toBe("light");
    expect(payload.settings.bg).toBe("#ffffff");
  });

  it("apply_theme_preset rejects unknown ids", async () => {
    await makeUserDataDir();
    const raw = executeCustomizationTool("apply_theme_preset", { preset: "neon" });
    const payload = JSON.parse(raw) as { error: string; presets: string[] };
    expect(payload.error).toContain("Unknown preset");
    expect(payload.presets).toContain("dark");
  });
});
