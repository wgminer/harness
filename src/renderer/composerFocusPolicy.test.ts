import { describe, expect, it } from "vitest";
import { shouldFocusComposerAfterTurn } from "./composerFocusPolicy";

describe("composerFocusPolicy", () => {
  it("focuses composer only when the document already has focus", () => {
    expect(shouldFocusComposerAfterTurn(true)).toBe(true);
    expect(shouldFocusComposerAfterTurn(false)).toBe(false);
  });
});
