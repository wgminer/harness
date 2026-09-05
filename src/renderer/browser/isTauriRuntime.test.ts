import { describe, expect, it } from "vitest";
import { isTauriRuntime } from "./isTauriRuntime";

describe("isTauriRuntime", () => {
  it("is false without Tauri globals", () => {
    expect(isTauriRuntime({} as Window)).toBe(false);
  });

  it("detects Tauri 2 internals", () => {
    expect(isTauriRuntime({ __TAURI_INTERNALS__: {} } as unknown as Window)).toBe(true);
  });

  it("detects the legacy Tauri global", () => {
    expect(isTauriRuntime({ __TAURI__: {} } as unknown as Window)).toBe(true);
  });
});
