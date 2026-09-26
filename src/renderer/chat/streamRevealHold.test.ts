import { describe, expect, it } from "vitest";
import {
  rememberStreamedAssistantId,
  shouldUseStreamingAssistantRenderer,
} from "./streamRevealHold";

describe("rememberStreamedAssistantId", () => {
  it("pins the live assistant while sending", () => {
    const next = rememberStreamedAssistantId(new Set(), true, "assistant-1");
    expect([...next]).toEqual(["assistant-1"]);
  });

  it("does not pin when not sending", () => {
    const current = new Set<string>();
    expect(rememberStreamedAssistantId(current, false, "assistant-1")).toBe(current);
  });

  it("keeps the same set when the id is already pinned", () => {
    const current = new Set(["assistant-1"]);
    expect(rememberStreamedAssistantId(current, true, "assistant-1")).toBe(current);
  });
});

describe("shouldUseStreamingAssistantRenderer", () => {
  it("uses the stream renderer for the latest pinned assistant after send ends", () => {
    expect(
      shouldUseStreamingAssistantRenderer(true, "assistant-1", new Set(["assistant-1"])),
    ).toBe(true);
  });

  it("does not keep the stream renderer on earlier assistants", () => {
    expect(
      shouldUseStreamingAssistantRenderer(false, "assistant-1", new Set(["assistant-1"])),
    ).toBe(false);
  });

  it("uses static markdown for history that was never streamed this session", () => {
    expect(
      shouldUseStreamingAssistantRenderer(true, "history-1", new Set(["assistant-1"])),
    ).toBe(false);
  });
});
