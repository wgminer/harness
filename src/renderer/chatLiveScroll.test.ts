import { describe, expect, it } from "vitest";
import {
  LIVE_EDGE_TOLERANCE_PX,
  distanceFromLiveEdge,
  scrollScrollContainerToLiveEdge,
  shouldScrollToLiveEdge,
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

describe("shouldScrollToLiveEdge", () => {
  it("snaps to the live edge on the first frame of a new turn", () => {
    expect(
      shouldScrollToLiveEdge({ justStartedTurn: true, followLiveEdge: false })
    ).toBe(true);
  });

  it("keeps following the live edge while the user stays near the bottom", () => {
    expect(
      shouldScrollToLiveEdge({ justStartedTurn: false, followLiveEdge: true })
    ).toBe(true);
  });

  it("releases the lock when the user scrolls up mid-stream", () => {
    expect(
      shouldScrollToLiveEdge({ justStartedTurn: false, followLiveEdge: false })
    ).toBe(false);
  });

  it("does not scroll when idle and away from the live edge", () => {
    expect(
      shouldScrollToLiveEdge({ justStartedTurn: false, followLiveEdge: false })
    ).toBe(false);
  });
});
