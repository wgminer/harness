import { describe, expect, it } from "vitest";
import {
  calculateBottomSpacerPx,
  computeScrollTopForMessage,
  isAlignedToTopOffset,
  shouldApplyTurnUpdate,
  shouldAutoScrollUserMessage,
} from "./chatTurnFlow";

describe("chatTurnFlow", () => {
  it("does not auto-scroll the first user message", () => {
    expect(shouldAutoScrollUserMessage(0)).toBe(false);
  });

  it("auto-scrolls after there is at least one prior user message", () => {
    expect(shouldAutoScrollUserMessage(1)).toBe(true);
    expect(shouldAutoScrollUserMessage(3)).toBe(true);
  });

  it("computes bottom spacer from measured layout values", () => {
    expect(
      calculateBottomSpacerPx({
        viewportHeight: 900,
        composerHeight: 120,
        userHeight: 220,
        assistantHeight: 80,
      })
    ).toBe(480);
  });

  it("clamps spacer to zero when content exceeds viewport", () => {
    expect(
      calculateBottomSpacerPx({
        viewportHeight: 400,
        composerHeight: 120,
        userHeight: 220,
        assistantHeight: 120,
      })
    ).toBe(0);
  });

  it("computes deterministic top-offset scroll target", () => {
    expect(
      computeScrollTopForMessage({
        scrollTop: 500,
        messageTopInContainer: 220,
        topOffset: 16,
      })
    ).toBe(704);
  });

  it("verifies alignment tolerance around the 16px target", () => {
    expect(
      isAlignedToTopOffset({
        messageTopInContainer: 16.5,
        topOffset: 16,
        tolerancePx: 1,
      })
    ).toBe(true);
    expect(
      isAlignedToTopOffset({
        messageTopInContainer: 18.2,
        topOffset: 16,
        tolerancePx: 1,
      })
    ).toBe(false);
  });

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
