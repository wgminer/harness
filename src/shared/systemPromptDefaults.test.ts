import { describe, expect, it } from "vitest";
import {
  assembleStaticSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT_SHARED,
} from "./systemPromptDefaults";
import { DEFAULT_SETTINGS } from "./types";

describe("DEFAULT_SETTINGS.systemPrompt", () => {
  it("includes shared, desktop, and ios defaults", () => {
    expect(DEFAULT_SETTINGS.systemPrompt?.shared).toBe(DEFAULT_SYSTEM_PROMPT.shared);
    expect(DEFAULT_SETTINGS.systemPrompt?.desktop).toContain("[CORE_INSTRUCTIONS]");
    expect(DEFAULT_SETTINGS.systemPrompt?.ios).toContain("Harness Mobile");
  });
});

describe("assembleStaticSystemPrompt", () => {
  it("combines shared with the selected platform overlay", () => {
    const fields = {
      shared: "SHARED",
      desktop: "DESKTOP",
      ios: "IOS",
    };
    expect(assembleStaticSystemPrompt(fields, "desktop")).toBe("SHARED\n\nDESKTOP");
    expect(assembleStaticSystemPrompt(fields, "ios")).toBe("SHARED\n\nIOS");
  });

  it("keeps shared identical in both platform previews", () => {
    const desktop = assembleStaticSystemPrompt(DEFAULT_SYSTEM_PROMPT, "desktop");
    const ios = assembleStaticSystemPrompt(DEFAULT_SYSTEM_PROMPT, "ios");
    expect(desktop.startsWith(DEFAULT_SYSTEM_PROMPT_SHARED)).toBe(true);
    expect(ios.startsWith(DEFAULT_SYSTEM_PROMPT_SHARED)).toBe(true);
    expect(desktop).toContain("local desktop app");
    expect(ios).toContain("Harness Mobile");
  });
});
