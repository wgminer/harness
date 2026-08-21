import { describe, expect, it } from "vitest";
import {
  LIVE_EDGE_TOLERANCE_PX,
  didTurnJustStart,
  distanceFromLiveEdge,
  isNearLiveEdge,
  scrollToLiveEdge,
  scrollTopDeltaForPaddingChange,
  shouldFollowTranscriptResize,
  shouldRepinFromUserScroll,
  shouldUnlockFromScrollDelta,
  trailingSpacerForOffset,
  turnParkPlan,
} from "./chatScrollLogic";

describe("chatScroll geometry", () => {
  it("computes distance from the bottom live edge", () => {
    const el = {
      scrollHeight: 1200,
      scrollTop: 800,
      clientHeight: 300,
    } as HTMLDivElement;
    expect(distanceFromLiveEdge(el)).toBe(100);
  });

  it("jumps scroll container to live edge", () => {
    const el = {
      scrollHeight: 2000,
      scrollTop: 10,
      clientHeight: 500,
    } as HTMLDivElement;
    scrollToLiveEdge(el);
    expect(el.scrollTop).toBe(1500);
  });

  it("exports a tolerance used by follow-edge logic", () => {
    expect(LIVE_EDGE_TOLERANCE_PX).toBeGreaterThan(0);
  });

  it("detects near live edge within tolerance", () => {
    const el = {
      scrollHeight: 1000,
      scrollTop: 470,
      clientHeight: 500,
    } as HTMLDivElement;
    expect(isNearLiveEdge(el)).toBe(true);
    expect(isNearLiveEdge(el, 16)).toBe(false);
  });
});

describe("scroll mode transitions", () => {
  it("pins on turn start rising edge only", () => {
    expect(didTurnJustStart(false, true)).toBe(true);
    expect(didTurnJustStart(true, true)).toBe(false);
    expect(didTurnJustStart(true, false)).toBe(false);
    expect(didTurnJustStart(false, false)).toBe(false);
  });

  it("follows transcript resize only while pinned and user has not taken over", () => {
    expect(shouldFollowTranscriptResize("pinned", false)).toBe(true);
    expect(shouldFollowTranscriptResize("pinned", true)).toBe(false);
    expect(shouldFollowTranscriptResize("free", false)).toBe(false);
    expect(shouldFollowTranscriptResize("free", true)).toBe(false);
  });

  it("unlocks when user scrolls up", () => {
    expect(shouldUnlockFromScrollDelta(500, 400)).toBe(true);
    expect(shouldUnlockFromScrollDelta(400, 500)).toBe(false);
    expect(shouldUnlockFromScrollDelta(400, 399)).toBe(false);
  });

  it("re-pins only when user scrolls down to the live edge", () => {
    expect(
      shouldRepinFromUserScroll({
        mode: "free",
        prevScrollTop: 460,
        nextScrollTop: 480,
        nearLiveEdge: true,
      })
    ).toBe("pinned");
    expect(
      shouldRepinFromUserScroll({
        mode: "free",
        prevScrollTop: 480,
        nextScrollTop: 460,
        nearLiveEdge: true,
      })
    ).toBe("free");
    expect(
      shouldRepinFromUserScroll({
        mode: "free",
        prevScrollTop: 460,
        nextScrollTop: 480,
        nearLiveEdge: false,
      })
    ).toBe("free");
    expect(
      shouldRepinFromUserScroll({
        mode: "pinned",
        prevScrollTop: 460,
        nextScrollTop: 480,
        nearLiveEdge: true,
      })
    ).toBe("pinned");
  });

  it("does not snap on stream end (no turn-start edge)", () => {
    expect(didTurnJustStart(true, false)).toBe(false);
  });
});

describe("turn parking", () => {
  it("parks the turn anchor below the headroom", () => {
    expect(
      turnParkPlan({ anchorTop: 900, headroom: 16, contentHeight: 2000, clientHeight: 800 })
    ).toEqual({ scrollTop: 884, spacer: 0 });
  });

  it("adds only the trailing space needed to reach the parked offset", () => {
    expect(
      turnParkPlan({ anchorTop: 900, headroom: 16, contentHeight: 1200, clientHeight: 800 })
    ).toEqual({ scrollTop: 884, spacer: 484 });
  });

  it("cannot park above the top of the thread", () => {
    expect(
      turnParkPlan({ anchorTop: 8, headroom: 16, contentHeight: 900, clientHeight: 800 })
    ).toEqual({ scrollTop: 0, spacer: 0 });
  });

  it("keeps the reader's offset reachable when trimming the spacer", () => {
    expect(
      trailingSpacerForOffset({ scrollTop: 884, contentHeight: 1200, clientHeight: 800 })
    ).toBe(484);
    expect(
      trailingSpacerForOffset({ scrollTop: 884, contentHeight: 2400, clientHeight: 800 })
    ).toBe(0);
  });
});

describe("composer padding compensation", () => {
  it("returns positive delta when dock grows", () => {
    expect(scrollTopDeltaForPaddingChange(140, 180)).toBe(40);
  });

  it("returns negative delta when dock shrinks", () => {
    expect(scrollTopDeltaForPaddingChange(180, 140)).toBe(-40);
  });
});
