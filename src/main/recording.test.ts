import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
  app: { getPath: vi.fn(() => "/tmp") },
  shell: { showItemInFolder: vi.fn(), openPath: vi.fn() },
  dialog: { showSaveDialog: vi.fn() },
  clipboard: { writeText: vi.fn() },
  systemPreferences: { getMediaAccessStatus: vi.fn(), askForMediaAccess: vi.fn() },
}));

import { applyTranscriptDictionary } from "./recording";

describe("applyTranscriptDictionary", () => {
  it("applies replacements case-insensitively", () => {
    const text = "wig em said hello to WIG EM.";
    const out = applyTranscriptDictionary(text, [{ from: "wig em", to: "WGM" }]);
    expect(out).toBe("WGM said hello to WGM.");
  });

  it("does not replace within larger words", () => {
    const text = "ann and annual meeting";
    const out = applyTranscriptDictionary(text, [{ from: "ann", to: "Anne" }]);
    expect(out).toBe("Anne and annual meeting");
  });
});
