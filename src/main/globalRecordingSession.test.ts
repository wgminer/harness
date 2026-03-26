import { describe, expect, it } from "vitest";
import {
  createInitialFnRecordingState,
  reduceFnEdge,
  reduceEscape,
} from "./globalRecordingSession";

describe("reduceFnEdge (single-tap toggle)", () => {
  const t0 = 1_000_000;

  it("single tap starts recording", () => {
    let s = createInitialFnRecordingState();
    const r = reduceFnEdge(s, "down", t0);
    expect(r.effects).toEqual([]);
    expect(r.next.session).toBe("none");
    s = r.next;

    const r2 = reduceFnEdge(s, "up", t0 + 50);
    expect(r2.effects).toEqual([{ kind: "startRecording" }]);
    expect(r2.next.session).toBe("toggle");
  });

  it("next tap stops recording", () => {
    let s = createInitialFnRecordingState();
    let r = reduceFnEdge(s, "down", t0);
    s = r.next;
    r = reduceFnEdge(s, "up", t0 + 50);
    expect(r.effects).toEqual([{ kind: "startRecording" }]);
    s = r.next;

    r = reduceFnEdge(s, "down", t0 + 100);
    s = r.next;
    r = reduceFnEdge(s, "up", t0 + 150);
    expect(r.effects).toEqual([{ kind: "stopRecording" }]);
    expect(r.next.session).toBe("none");
  });

  it("up without a preceding down does nothing", () => {
    const s = createInitialFnRecordingState();
    const r = reduceFnEdge(s, "up", t0);
    expect(r.effects).toEqual([]);
    expect(r.next.session).toBe("none");
  });

  it("repeated down events before up do not emit effects", () => {
    let s = createInitialFnRecordingState();
    let r = reduceFnEdge(s, "down", t0);
    s = r.next;
    r = reduceFnEdge(s, "down", t0 + 20);
    expect(r.effects).toEqual([]);
    s = r.next;
    r = reduceFnEdge(s, "up", t0 + 40);
    expect(r.effects).toEqual([{ kind: "startRecording" }]);
    expect(r.next.session).toBe("toggle");
  });

  it("escape cancels from ptt", () => {
    let s = createInitialFnRecordingState();
    let r = reduceFnEdge(s, "down", t0);
    s = r.next;
    r = reduceFnEdge(s, "up", t0 + 10);
    s = r.next;
    r = reduceEscape(s);
    expect(r.effects).toEqual([{ kind: "cancelRecording" }]);
    expect(r.next.session).toBe("none");
  });
});
