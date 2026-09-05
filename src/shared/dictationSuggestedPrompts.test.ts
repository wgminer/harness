import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import contract from "../../resources/contracts/dictationSuggestedPrompts.json";
import {
  buildDictationSuggestUserMessage,
  clampDictationReplyAction,
  DICTATION_REPLY_RUN_ACTION,
  DICTATION_SUGGEST_SYSTEM_PROMPT,
  DICTATION_SUGGEST_VOCABULARY,
  dictationReplyActionLabel,
  isDictationReplyAction,
} from "./dictationSuggestedPrompts";

const root = join(import.meta.dirname, "../..");

describe("dictationSuggestedPrompts contract", () => {
  it("exposes system prompt, vocabulary, and run fallback", () => {
    expect(DICTATION_SUGGEST_SYSTEM_PROMPT.length).toBeGreaterThan(40);
    expect(DICTATION_SUGGEST_VOCABULARY).toEqual([
      "Summarize",
      "Distill",
      "Breakdown",
      "Proofread",
    ]);
    expect(DICTATION_REPLY_RUN_ACTION).toBe("run");
    expect(contract.vocabulary).toEqual(DICTATION_SUGGEST_VOCABULARY);
    expect(DICTATION_SUGGEST_SYSTEM_PROMPT).toMatch(/Proofread/i);
    expect(DICTATION_SUGGEST_SYSTEM_PROMPT).toMatch(/outgoing text/i);
  });

  it("is include_str!'d by Rust", () => {
    const rust = readFileSync(
      join(root, "src-tauri/src/dictation_suggested_prompts.rs"),
      "utf8",
    );
    expect(rust).toContain(
      'include_str!("../../resources/contracts/dictationSuggestedPrompts.json")',
    );
  });
});

describe("clampDictationReplyAction", () => {
  it("accepts run and vocabulary words", () => {
    expect(clampDictationReplyAction({ action: "run" })).toBe("run");
    expect(clampDictationReplyAction({ action: "Distill" })).toBe("Distill");
    expect(clampDictationReplyAction({ action: "summarize" })).toBe("Summarize");
  });

  it("falls back to run on unknown or empty", () => {
    expect(clampDictationReplyAction({ action: "Continue" })).toBe("run");
    expect(clampDictationReplyAction({})).toBe("run");
    expect(clampDictationReplyAction(null)).toBe("run");
  });

  it("parses JSON strings", () => {
    expect(clampDictationReplyAction('{"action":"Proofread"}')).toBe("Proofread");
  });
});

describe("helpers", () => {
  it("builds transcript markers", () => {
    const msg = buildDictationSuggestUserMessage(" hello ");
    expect(msg).toContain("<<<TRANSCRIPT>>>");
    expect(msg).toContain("hello");
    expect(msg).toContain("<<<END>>>");
  });

  it("labels Run for display", () => {
    expect(dictationReplyActionLabel("run")).toBe("Run");
    expect(dictationReplyActionLabel("Distill")).toBe("Distill");
    expect(isDictationReplyAction("Breakdown")).toBe(true);
    expect(isDictationReplyAction("nope")).toBe(false);
  });
});
