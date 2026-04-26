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
