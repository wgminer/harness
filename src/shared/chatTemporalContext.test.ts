import { describe, expect, it } from "vitest";
import {
  annotateMessageContentForModel,
  formatTemporalContextBlock,
  stripSentAtPrefix,
} from "./chatTemporalContext";

describe("chatTemporalContext", () => {
  it("adds sent_at prefix when timestamp is known", () => {
    const out = annotateMessageContentForModel("Meet Tuesday", 1_700_000_000_000);
    expect(out).toMatch(/^\[sent_at=2023-11-14T22:13:20\.000Z\]\nMeet Tuesday$/);
  });

  it("leaves content unchanged without timestamp", () => {
    expect(annotateMessageContentForModel("plain", undefined)).toBe("plain");
  });

  it("does not double-prefix", () => {
    const once = annotateMessageContentForModel("x", 1_000);
    const twice = annotateMessageContentForModel(once, 2_000);
    expect(twice).toBe(once);
  });

  it("stripSentAtPrefix removes annotation", () => {
    const annotated = annotateMessageContentForModel("body", 1_000);
    expect(stripSentAtPrefix(annotated)).toBe("body");
  });

  it("formatTemporalContextBlock includes timezone label", () => {
    const block = formatTemporalContextBlock(new Date("2026-05-27T12:00:00Z"), "UTC");
    expect(block).toContain("[TEMPORAL_CONTEXT]");
    expect(block).toContain("(UTC):");
    expect(block).toContain("already passed");
  });
});
