import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assembleStaticSystemPrompt,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT_DESKTOP,
  DEFAULT_SYSTEM_PROMPT_IOS,
  DEFAULT_SYSTEM_PROMPT_SHARED,
} from "./systemPromptDefaults";

const root = join(__dirname, "../..");

interface SystemPromptContract {
  shared: string;
  desktop: string;
  ios: string;
}

function readContract(): SystemPromptContract {
  const raw = readFileSync(join(root, "resources/contracts/systemPrompt.json"), "utf8");
  return JSON.parse(raw) as SystemPromptContract;
}

describe("resources/contracts/systemPrompt.json", () => {
  it("has shared / desktop / ios string fields", () => {
    const c = readContract();
    expect(typeof c.shared).toBe("string");
    expect(typeof c.desktop).toBe("string");
    expect(typeof c.ios).toBe("string");
    expect(c.shared.length).toBeGreaterThan(0);
    expect(c.desktop.length).toBeGreaterThan(0);
    expect(c.ios.length).toBeGreaterThan(0);
  });

  it("keeps ask_user on desktop only", () => {
    const c = readContract();
    expect(c.shared).not.toContain("[FORMATTING_CAPABILITIES]");
    expect(c.desktop).toContain("ask_user");
    expect(c.desktop).not.toContain("[FORMATTING_CAPABILITIES]");
    expect(c.ios).not.toContain("[FORMATTING_CAPABILITIES]");
    expect(c.shared).toContain("[CONVERSATION_RECALL]");
  });

  it("matches TS defaults imported from the same file", () => {
    const c = readContract();
    expect(DEFAULT_SYSTEM_PROMPT_SHARED).toBe(c.shared);
    expect(DEFAULT_SYSTEM_PROMPT_DESKTOP).toBe(c.desktop);
    expect(DEFAULT_SYSTEM_PROMPT_IOS).toBe(c.ios);
  });

  it("is include_str!'d by Rust (system_prompt.rs)", () => {
    const rust = readFileSync(join(root, "src-tauri/src/system_prompt.rs"), "utf8");
    expect(rust).toContain('include_str!("../../resources/contracts/systemPrompt.json")');
  });
});

describe("DEFAULT_SYSTEM_PROMPT", () => {
  it("matches contract shared / desktop / ios fields", () => {
    const c = readContract();
    expect(DEFAULT_SYSTEM_PROMPT.shared).toBe(c.shared);
    expect(DEFAULT_SYSTEM_PROMPT.desktop).toContain("[CORE_INSTRUCTIONS]");
    expect(DEFAULT_SYSTEM_PROMPT.desktop).toContain("ask_user");
    expect(DEFAULT_SYSTEM_PROMPT.ios).toContain("Harness Mobile");
    expect(DEFAULT_SYSTEM_PROMPT.shared).not.toContain("[FORMATTING_CAPABILITIES]");
    expect(DEFAULT_SYSTEM_PROMPT.desktop).not.toContain("[FORMATTING_CAPABILITIES]");
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
