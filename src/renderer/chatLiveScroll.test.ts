import { describe, expect, it } from "vitest";
import {
  LIVE_EDGE_TOLERANCE_PX,
  distanceFromLiveEdge,
  scrollScrollContainerToLiveEdge,
} from "./chatLiveScroll";

describe("chatLiveScroll", () => {
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
    scrollScrollContainerToLiveEdge(el);
    expect(el.scrollTop).toBe(1500);
  });

  it("exports a tolerance used by follow-edge logic", () => {
    expect(LIVE_EDGE_TOLERANCE_PX).toBeGreaterThan(0);
  });
});

/** Mirrors scroll gating in useFollowChatLiveEdge (keep in sync). */
function shouldScrollToLiveEdge(args: {
  justStartedTurn: boolean;
  sending: boolean;
  followLiveEdge: boolean;
}): boolean {
  return args.justStartedTurn || args.sending || args.followLiveEdge;
}

describe("shouldScrollToLiveEdge", () => {
  it("follows the live edge for the whole model turn even when the user had scrolled up", () => {
    expect(
      shouldScrollToLiveEdge({ justStartedTurn: false, sending: true, followLiveEdge: false })
    ).toBe(true);
  });

  it("does not scroll when idle and away from the live edge", () => {
    expect(
      shouldScrollToLiveEdge({ justStartedTurn: false, sending: false, followLiveEdge: false })
    ).toBe(false);
  });
});
