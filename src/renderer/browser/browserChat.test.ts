import { describe, expect, it } from "vitest";
import { consumeSseBuffer, extractDeltaContent, fallbackTitleFromMessages } from "./browserChat";

describe("consumeSseBuffer", () => {
  it("splits complete events and keeps a partial tail", () => {
    const { events, rest } = consumeSseBuffer("data: {\"a\":1}\n\ndata: {\"b\":2}\n\ndata: {\"c\"");
    expect(events).toEqual(['data: {"a":1}', 'data: {"b":2}']);
    expect(rest).toBe('data: {"c"');
  });
});

describe("extractDeltaContent", () => {
  it("reads streamed chat delta text", () => {
    expect(
      extractDeltaContent({
        choices: [{ delta: { content: "Hello" } }],
      }),
    ).toBe("Hello");
    expect(extractDeltaContent({ choices: [{ delta: {} }] })).toBe("");
  });
});

describe("fallbackTitleFromMessages", () => {
  it("uses the first user turn, trimmed and truncated", () => {
    expect(
      fallbackTitleFromMessages([
        { role: "assistant", content: "ignore" },
        { role: "user", content: "  Fix the sidebar scroll bug  " },
      ]),
    ).toBe("Fix the sidebar scroll bug");
  });
});
