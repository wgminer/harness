import { describe, expect, it } from "vitest";
import { splitStreamingMarkdown } from "../../shared/streamingMarkdownBlocks";
import {
  DEV_CHAT_ASSISTANT_1,
  advanceMockStreamIndex,
  isMockStreamComplete,
  mockStreamContent,
} from "./useMockAssistantStream";

describe("useMockAssistantStream helpers", () => {
  it("start() grows content monotonically", () => {
    const fixture = "Hello world";
    let index = 0;
    const chunkSize = 4;
    const steps: string[] = [];
    while (!isMockStreamComplete(index, fixture.length)) {
      index = advanceMockStreamIndex(index, chunkSize, fixture.length);
      steps.push(mockStreamContent(index, fixture));
    }
    expect(steps.length).toBeGreaterThan(0);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i]!.length).toBeGreaterThanOrEqual(steps[i - 1]!.length);
    }
    expect(steps[steps.length - 1]).toBe(fixture);
  });

  it("reset() baseline is empty content", () => {
    expect(mockStreamContent(0, "abc")).toBe("");
    expect(isMockStreamComplete(0, 3)).toBe(false);
  });

  it("fixture round-trips through splitStreamingMarkdown at final content", () => {
    const blocks = splitStreamingMarkdown(DEV_CHAT_ASSISTANT_1);
    expect(blocks.completed.join("") + blocks.trailing).toBe(DEV_CHAT_ASSISTANT_1);
  });
});
