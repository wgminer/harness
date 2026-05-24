import { describe, expect, it } from "vitest";
import { DICTATION_REPLY_LABEL, resolveDictationReplyLabel } from "./dictationReplyStrip";

describe("resolveDictationReplyLabel", () => {
  it("returns the same generic label for any transcript", () => {
    expect(resolveDictationReplyLabel()).toBe(DICTATION_REPLY_LABEL);
  });
});
