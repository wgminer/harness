import { describe, expect, it } from "vitest";
import { shouldApplyTurnUpdate } from "./chatTurnFlow";

describe("chatTurnFlow", () => {
  it("rejects stale or aborted turn updates", () => {
    expect(
      shouldApplyTurnUpdate({
        activeTurnId: 5,
        expectedTurnId: 4,
        aborted: false,
      })
    ).toBe(false);
    expect(
      shouldApplyTurnUpdate({
        activeTurnId: 5,
        expectedTurnId: 5,
        aborted: true,
      })
    ).toBe(false);
    expect(
      shouldApplyTurnUpdate({
        activeTurnId: 5,
        expectedTurnId: 5,
        aborted: false,
      })
    ).toBe(true);
  });
});
