import { describe, expect, it } from "vitest";
import { LAYOUT_DEBUG_TARGETS } from "./layoutDebugTargets";
import { measureLayoutBoxes } from "./measureLayoutBoxes";

function fakeEl(rect: { width: number; height: number; top?: number; left?: number }, excluded = false) {
  return {
    getBoundingClientRect: () => ({
      width: rect.width,
      height: rect.height,
      top: rect.top ?? 0,
      left: rect.left ?? 8,
    }),
    closest: (selector: string) => (excluded && selector === ".layout-debug-root" ? {} : null),
  };
}

describe("measureLayoutBoxes", () => {
  it("measures every message match and skips zero-size spacers", () => {
    const boxes = measureLayoutBoxes(
      LAYOUT_DEBUG_TARGETS.filter((t) => t.id === "message" || t.id === "live-edge"),
      (selector) => {
        if (selector === ".message-block") {
          return [fakeEl({ width: 640, height: 88 }), fakeEl({ width: 640, height: 210 })];
        }
        if (selector === ".chat-live-edge") {
          return [fakeEl({ width: 640, height: 0 })];
        }
        return [];
      },
    );
    expect(boxes).toEqual([
      {
        id: "message",
        instance: 0,
        label: "Message 1",
        color: "#818cf8",
        width: 640,
        height: 88,
        top: 0,
        left: 8,
      },
      {
        id: "message",
        instance: 1,
        label: "Message 2",
        color: "#818cf8",
        width: 640,
        height: 210,
        top: 0,
        left: 8,
      },
    ]);
  });

  it("hides a target and ignores debug-root nodes", () => {
    const boxes = measureLayoutBoxes(
      LAYOUT_DEBUG_TARGETS.filter((t) => t.id === "scroll"),
      () => [fakeEl({ width: 800, height: 600 }, true)],
      new Set(["scroll"]),
    );
    expect(boxes).toEqual([]);
  });
});
