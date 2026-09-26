import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import contract from "../../resources/contracts/recentConversations.json";
import {
  RECENT_PER_CHAT_BODY_BUDGET,
  RECENT_PROTECT_RECENT_COUNT,
  RECENT_TOTAL_BODY_BUDGET,
  applyTotalBodyBudget,
  cleanDialogueBody,
  extractDialogueTurns,
  stripSentAtPrefix,
} from "./recentConversations";

describe("recentConversations", () => {
  it("strips sent_at metadata from user text", () => {
    expect(stripSentAtPrefix("[sent_at=2026-01-01T00:00:00Z]\nHello")).toBe("Hello");
  });

  it("keeps user/assistant turns and drops system/tool-only assistant", () => {
    const turns = extractDialogueTurns([
      { role: "system", content: "ignore" },
      { role: "user", content: "Hi" },
      { role: "assistant", content: "", toolCalls: [{ toolName: "task_list" }] },
      { role: "assistant", content: "Hello" },
    ]);
    expect(turns).toEqual([
      { role: "User", text: "Hi" },
      { role: "Assistant", text: "Hello" },
    ]);
  });

  it("windows dialogue from the end within per-chat budget", () => {
    const body = cleanDialogueBody(
      [
        { role: "user", content: "old" },
        { role: "assistant", content: "old reply" },
        { role: "user", content: "new question" },
        { role: "assistant", content: "new answer" },
      ],
      50,
    );
    expect(body).toContain("User: new question");
    expect(body).not.toContain("old reply");
  });

  it("truncates an oversized single turn from the tail", () => {
    const body = cleanDialogueBody([{ role: "user", content: "x".repeat(2500) }], 2000);
    expect(body.startsWith("User: …")).toBe(true);
    expect([...body].length).toBeLessThanOrEqual(2006);
  });

  it("protects the three newest bodies when trimming total budget", () => {
    const bodies = applyTotalBodyBudget([
      "a".repeat(2500),
      "b".repeat(2500),
      "c".repeat(2500),
      "d".repeat(2500),
    ]);
    expect(bodies[0].length).toBe(2500);
    expect(bodies[1].length).toBe(2500);
    expect(bodies[2].length).toBe(2500);
    expect(bodies[3].length).toBe(500);
    expect(bodies.reduce((sum, body) => sum + body.length, 0)).toBeLessThanOrEqual(8000);
  });
});

describe("resources/contracts/recentConversations.json", () => {
  const root = join(import.meta.dirname, "../..");

  it("drives the TS budgets", () => {
    expect(RECENT_PER_CHAT_BODY_BUDGET).toBe(contract.perChatBodyBudget);
    expect(RECENT_TOTAL_BODY_BUDGET).toBe(contract.totalBodyBudget);
    expect(RECENT_PROTECT_RECENT_COUNT).toBe(contract.protectRecentCount);
  });

  it("is include_str!'d by Rust", () => {
    const rust = readFileSync(join(root, "src-tauri/src/memory/recent.rs"), "utf8");
    expect(rust).toContain('include_str!("../../../resources/contracts/recentConversations.json")');
    expect(rust).not.toMatch(/const RECENT_[A-Z_]+: usize = \d+/);
  });

  it("is loaded from the bundle by iOS", () => {
    const swift = readFileSync(join(root, "ios/HarnessMobile/Chat/RecentConversations.swift"), "utf8");
    expect(swift).toContain('forResource: "recentConversations"');
  });
});
