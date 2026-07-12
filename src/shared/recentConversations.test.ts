import { describe, expect, it } from "vitest";
import {
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
