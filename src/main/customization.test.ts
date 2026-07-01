import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "./__tests__/tempDir";

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
  it("set_layout updates sidebar and grid overlay", async () => {
    await makeUserDataDir();
    const raw = executeCustomizationTool("set_layout", { sidebar: "right", gridOverlay: "8" });
    const payload = JSON.parse(raw) as {
      ok: boolean;
      layout: { sidebar: string; gridOverlay: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.layout.sidebar).toBe("right");
    expect(payload.layout.gridOverlay).toBe("8");
  });
});
